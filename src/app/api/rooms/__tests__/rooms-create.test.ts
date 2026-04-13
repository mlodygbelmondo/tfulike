import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/route";
// Mock the supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TEST_USER_ID = "auth-user-1";

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

function makeAuthMock(user: { id: string } | null) {
  return {
    getUser: vi.fn().mockResolvedValue({ data: { user } }),
  };
}

describe("POST /api/rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    const sb = {
      auth: makeAuthMock(null),
      from: vi.fn(() => makeChain({ data: null, error: null })),
      rpc: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("returns 400 when profile not found", async () => {
    const sb = {
      auth: makeAuthMock({ id: TEST_USER_ID }),
      from: vi.fn(() => makeChain({ data: null, error: null })),
      rpc: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/profile/i);
  });

  it("returns 500 when PIN generation fails", async () => {
    let fromCallCount = 0;
    const sb = {
      auth: makeAuthMock({ id: TEST_USER_ID }),
      from: vi.fn(() => {
        const results = [
          // profiles query
          { data: { nickname: "Alice", color: "#ff2d55", tiktok_username: "cooluser", onboarding_completed: true }, error: null },
        ];
        const result = results[fromCallCount] || { data: null, error: null };
        fromCallCount++;
        return makeChain(result);
      }),
      rpc: vi.fn(() => makeChain({ data: null, error: { message: "rpc error" } })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/pin/i);
  });

  it("returns 500 when room insert fails", async () => {
    let fromCallCount = 0;
    const sb = {
      auth: makeAuthMock({ id: TEST_USER_ID }),
      from: vi.fn(() => {
        const results = [
          // profiles query
          { data: { nickname: "Alice", color: "#ff2d55", tiktok_username: "cooluser", onboarding_completed: true }, error: null },
        ];
        const result = results[fromCallCount] || { data: null, error: null };
        fromCallCount++;
        return makeChain(result);
      }),
      rpc: vi.fn(() => makeChain({ data: "1234", error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: { message: "insert error" } })) } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/room/i);
  });

  it("creates room and player on success using auth profile", async () => {
    const room = { id: "room-1", pin: "1234", status: "lobby", host_player_id: null };
    const player = { id: "player-1", nickname: "Alice", color: "#ff2d55" };

    let fromCallCount = 0;
    const results = [
      // profiles query
      {
        data: {
          nickname: "Alice",
          color: "#ff2d55",
          tiktok_username: "cooluser",
          sync_status: "synced",
          synced_at: "2025-01-01T00:00:00.000Z",
          onboarding_completed: true,
        },
        error: null,
      },
    ];

    const insertSpy = vi.fn();
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock({ id: TEST_USER_ID }),
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
    const adminResults = [
      { data: room, error: null },
      { data: player, error: null },
      { data: null, error: null },
    ];
    const adminSb = {
      from: vi.fn((table: string) => {
        const result = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        const chain = makeChain(result) as Record<string, ReturnType<typeof vi.fn>>;
        if (table === "players") {
          chain.insert = insertSpy.mockReturnValue(chain);
        }
        return chain;
      }),
    };

    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue(adminSb as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.room.pin).toBe("1234");
    expect(json.player.nickname).toBe("Alice");

    // Player insert should include user_id and profile data
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        nickname: "Alice",
        color: "#ff2d55",
        is_host: true,
        tiktok_username: "cooluser",
        sync_status: "synced",
        synced_at: "2025-01-01T00:00:00.000Z",
      })
    );
  });
});
