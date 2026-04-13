import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/join/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TEST_USER_ID = "auth-user-1";

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

function makeAuthMock(userId: string | null) {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { user: userId ? { id: userId } : null },
    }),
  };
}

const testProfile = {
  nickname: "Bob",
  color: "#ff2d55",
  tiktok_username: "likedvideos",
  sync_status: "synced",
  synced_at: "2025-01-01T00:00:00.000Z",
  onboarding_completed: true,
};

describe("POST /api/rooms/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when pin is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/pin/i);
  });

  it("returns 400 when PIN is not 4 digits", async () => {
    const res = await POST(makeRequest({ pin: "12" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/4 digits/i);
  });

  it("returns 400 for non-numeric PIN", async () => {
    const res = await POST(makeRequest({ pin: "abcd" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not authenticated", async () => {
    const sb = {
      auth: makeAuthMock(null),
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest({ pin: "1234" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("returns 400 when profile not found", async () => {
    let callIdx = 0;
    const results = [
      // profiles query → not found
      { data: null, error: null },
    ];
    const sb = {
      auth: makeAuthMock(TEST_USER_ID),
      from: vi.fn(() => {
        const result = results[callIdx] || { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest({ pin: "1234" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/profile/i);
  });

  it("returns 404 when room not found", async () => {
    let callIdx = 0;
    const results = [
      // profiles query
      { data: testProfile, error: null },
      // rooms select → single (not found)
      { data: null, error: { code: "PGRST116", message: "not found" } },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock(TEST_USER_ID),
      from: vi.fn(() => {
        const result = callIdx === 0 ? results[0] : { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const adminResults = [results[1]];
        const result = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(result);
      }),
    } as never);

    const res = await POST(makeRequest({ pin: "9999" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when room is full (8 players)", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const results = [
      // profiles query
      { data: testProfile, error: null },
      // rooms select
      { data: room, error: null },
      // players count
      { data: null, error: null, count: 8 },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock(TEST_USER_ID),
      from: vi.fn(() => {
        const result = callIdx === 0 ? results[0] : { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const adminResults = [results[1], results[2]];
        const result = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(result);
      }),
    } as never);

    const res = await POST(makeRequest({ pin: "1234" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/full/i);
  });

  it("returns existing player when user already joined room", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const existingPlayer = { id: "p-existing" };
    const results = [
      // profiles query
      { data: testProfile, error: null },
      // rooms select
      { data: room, error: null },
      // players count
      { data: null, error: null, count: 3 },
      // existing player check (user_id match)
      { data: existingPlayer, error: null },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock(TEST_USER_ID),
      from: vi.fn(() => {
        const result = callIdx === 0 ? results[0] : { data: null, error: null };
        callIdx++;
        return makeChain(result);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const adminResults = [results[1], results[2], results[3]];
        const result = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(result);
      }),
    } as never);

    const res = await POST(makeRequest({ pin: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.player.id).toBe("p-existing");
  });

  it("joins room successfully using auth profile data", async () => {
    let callIdx = 0;
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const player = { id: "p2", nickname: "Bob", color: "#ff2d55" };
    const results = [
      // profiles query
      { data: testProfile, error: null },
      // rooms select
      { data: room, error: null },
      // players count
      { data: null, error: null, count: 3 },
      // existing player check — not found
      { data: null, error: { code: "PGRST116" } },
      // duplicate nickname check — not found
      { data: null, error: { code: "PGRST116" } },
      // existing colors
      { data: [{ color: "#5856d6" }], error: null },
      // player insert
      { data: player, error: null },
    ];

    const insertSpy = vi.fn();
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock(TEST_USER_ID),
      from: vi.fn(() => {
        const result = callIdx === 0 ? results[0] : { data: null, error: null };
        callIdx++;
        return makeChain(result) as Record<string, ReturnType<typeof vi.fn>>;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        const adminResults = results.slice(1);
        const result = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        const chain = makeChain(result) as Record<string, ReturnType<typeof vi.fn>>;
        if (table === "players" && adminIdx === adminResults.length) {
          chain.insert = insertSpy.mockReturnValue(chain);
        }
        return chain;
      }),
    } as never);

    const res = await POST(makeRequest({ pin: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.room.pin).toBe("1234");
    expect(json.player.nickname).toBe("Bob");

    // Player insert should include user_id and profile data
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        nickname: "Bob",
        color: "#ff2d55",
        is_host: false,
        tiktok_username: "likedvideos",
        sync_status: "synced",
        synced_at: "2025-01-01T00:00:00.000Z",
      })
    );
  });
});
