import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/settings/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function makeAuthMock(userId: string | null) {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { user: userId ? { id: userId } : null },
    }),
  };
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

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/rooms/1234/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when user is not authenticated", async () => {
    const sb = {
      auth: makeAuthMock(null),
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest({ max_rounds: 6 }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when room is not found", async () => {
    const sb = {
      auth: makeAuthMock("auth-host"),
      from: vi.fn(() => makeChain({ data: null, error: { message: "not found" } })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest({ max_rounds: 6 }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the host", async () => {
    let idx = 0;
    const room = { id: "room-1", pin: "1234", host_player_id: "host-player", settings: {} };
    const results = [
      { data: room, error: null },
      { data: { id: "guest-player", user_id: "auth-guest" }, error: null },
    ];
    const sb = {
      auth: makeAuthMock("auth-guest"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx += 1;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(makeRequest({ max_rounds: 6 }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid round count", async () => {
    const res = await POST(makeRequest({ max_rounds: -1 }), { params });
    expect(res.status).toBe(400);
  });

  it("updates room settings for the authenticated host", async () => {
    let idx = 0;
    const room = {
      id: "room-1",
      pin: "1234",
      host_player_id: "host-player",
      settings: { max_rounds: 3, round_timer: 15 },
    };
    const updatedRoom = {
      ...room,
      settings: { max_rounds: 6, round_timer: 15 },
    };
    const sb = {
      auth: makeAuthMock("auth-host"),
      from: vi.fn(() => {
        const baseResults = [
          { data: room, error: null },
          { data: { id: "host-player", user_id: "auth-host" }, error: null },
        ];
        const r = baseResults[idx] || { data: null, error: null };
        idx += 1;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => makeChain({ data: updatedRoom, error: null })),
    } as never);

    const res = await POST(makeRequest({ max_rounds: 6 }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.room.settings.max_rounds).toBe(6);
    expect(json.room.settings.round_timer).toBe(15);
  });
});
