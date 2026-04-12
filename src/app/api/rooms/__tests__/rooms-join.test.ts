import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/join/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/rooms/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeChain(resolveValue: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(resolveValue);
      if (prop in target) return target[prop as keyof typeof target];
      const fn = vi.fn(() => proxy);
      target[prop as string] = fn;
      return fn;
    },
  });
  return proxy;
}

describe("POST /api/rooms/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when pin is missing", async () => {
    const res = await POST(
      makeRequest({
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/pin/i);
  });

  it("accepts tiktok_username when joining a room", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const player = {
      id: "p2",
      nickname: "Bob",
      color: "#ff2d55",
      tiktok_username: "likedvideos",
    };
    const results = [
      { data: room, error: null },
      { data: null, error: null, count: 3 },
      { data: null, error: { code: "PGRST116" } },
      { data: [{ color: "#5856d6" }], error: null },
      { data: player, error: null },
    ];

    const insertSpy = vi.fn();
    const sb = {
      from: vi.fn((table: string) => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        const chain = makeChain(result) as Record<string, ReturnType<typeof vi.fn>>;
        if (table === "players") {
          chain.insert = insertSpy.mockReturnValue(chain);
        }
        return chain;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        pin: "1234",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        nickname: "Bob",
        color: "#ff2d55",
        is_host: false,
        tiktok_username: "likedvideos",
      })
    );
  });

  it("returns 400 when nickname is missing", async () => {
    const res = await POST(
      makeRequest({
        pin: "1234",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when PIN is not 4 digits", async () => {
    const res = await POST(
      makeRequest({
        pin: "12",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/4 digits/i);
  });

  it("returns 400 for non-numeric PIN", async () => {
    const res = await POST(
      makeRequest({
        pin: "abcd",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when room not found", async () => {
    let callIdx = 0;
    const results = [
      // rooms select → single (not found)
      { data: null, error: { code: "PGRST116", message: "not found" } },
    ];
    const sb = {
      from: vi.fn(() => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        pin: "9999",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when room is full (8 players)", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const results = [
      // rooms select
      { data: room, error: null },
      // players count
      { data: null, error: null, count: 8 },
    ];
    const sb = {
      from: vi.fn(() => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        pin: "1234",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/full/i);
  });

  it("returns 400 when nickname already taken", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const results = [
      { data: room, error: null },
      { data: null, error: null, count: 3 },
      // duplicate nickname check
      { data: { id: "existing" }, error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        pin: "1234",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/nickname/i);
  });

  it("joins room successfully with available color", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const player = { id: "p2", nickname: "Bob", color: "#ff2d55" };
    const results = [
      { data: room, error: null },
      { data: null, error: null, count: 3 },
      // no duplicate nickname
      { data: null, error: { code: "PGRST116" } },
      // existing colors
      { data: [{ color: "#5856d6" }], error: null },
      // player insert
      { data: player, error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        pin: "1234",
        nickname: "Bob",
        color: "#ff2d55",
        tiktok_username: "likedvideos",
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.room.pin).toBe("1234");
    expect(json.player.nickname).toBe("Bob");
  });
});
