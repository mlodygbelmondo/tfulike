import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/route";
import { createRoutableMock } from "@/__tests__/helpers/supabase-mock";

// Mock the supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when nickname is missing", async () => {
    const res = await POST(
      makeRequest({ color: "#ff2d55", tiktok_username: "cooluser" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/nickname/i);
  });

  it("returns 400 when color is missing", async () => {
    const res = await POST(
      makeRequest({ nickname: "Alice", tiktok_username: "cooluser" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/color/i);
  });

  it("accepts tiktok_username when creating the host player", async () => {
    const room = { id: "room-1", pin: "1234", status: "lobby", host_player_id: null };
    const player = {
      id: "player-1",
      nickname: "Alice",
      color: "#ff2d55",
      session_token: "tok",
      tiktok_username: "cooluser",
    };

    let fromCallCount = 0;
    const results = [
      { data: room, error: null },
      { data: player, error: null },
      { data: null, error: null },
    ];

    function makeChain(resolveValue: { data: unknown; error: unknown }) {
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

    const insertSpy = vi.fn();
    const sb = {
      rpc: vi.fn(() => makeChain({ data: "1234", error: null })),
      from: vi.fn((table: string) => {
        const result = results[fromCallCount] || { data: null, error: null };
        fromCallCount++;
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
        nickname: "Alice",
        color: "#ff2d55",
        tiktok_username: "cooluser",
      })
    );

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        nickname: "Alice",
        color: "#ff2d55",
        is_host: true,
        tiktok_username: "cooluser",
      })
    );
  });

  it("returns 400 when nickname is only whitespace", async () => {
    const res = await POST(
      makeRequest({
        nickname: "   ",
        color: "#ff2d55",
        tiktok_username: "cooluser",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when PIN generation fails", async () => {
    const sb = createRoutableMock({});
    sb._setRpc({ data: null, error: { message: "rpc error" } });
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        nickname: "Alice",
        color: "#ff2d55",
        tiktok_username: "cooluser",
      })
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/pin/i);
  });

  it("returns 500 when room insert fails", async () => {
    const sb = createRoutableMock({
      rooms: { data: null, error: { message: "insert error" } },
    });
    sb._setRpc({ data: "1234", error: null });
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        nickname: "Alice",
        color: "#ff2d55",
        tiktok_username: "cooluser",
      })
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/room/i);
  });

  it("creates room and player on success", async () => {
    const room = { id: "room-1", pin: "1234", status: "lobby", host_player_id: null };
    const player = { id: "player-1", nickname: "Alice", color: "#ff2d55", session_token: "tok" };

    // We need a more fine-grained mock for this success path since .from()
    // is called for rooms (insert then update) and players (insert)
    let fromCallCount = 0;
    const results = [
      // rooms insert → select → single
      { data: room, error: null },
      // players insert → select → single
      { data: player, error: null },
      // rooms update (set host_player_id)
      { data: null, error: null },
    ];

    function makeChain(resolveValue: { data: unknown; error: unknown }) {
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

    const sb = {
      rpc: vi.fn(() => makeChain({ data: "1234", error: null })),
      from: vi.fn(() => {
        const result = results[fromCallCount] || { data: null, error: null };
        fromCallCount++;
        return makeChain(result);
      }),
    };

    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        nickname: "Alice",
        color: "#ff2d55",
        tiktok_username: "cooluser",
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.room.pin).toBe("1234");
    expect(json.player.nickname).toBe("Alice");
  });
});
