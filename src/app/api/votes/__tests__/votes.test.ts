import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/votes/route";

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
  return new Request("http://localhost/api/votes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/votes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when user is not authenticated", async () => {
    const sb = {
      auth: makeAuthMock(null),
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(
      makeRequest({ round_id: "r1", guessed_player_id: "p2" })
    );

    expect(res.status).toBe(401);
  });

  it("returns 400 when round_id is missing", async () => {
    const res = await POST(
      makeRequest({ player_id: "p1", guessed_player_id: "p2" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when authenticated user is not a player in the round room", async () => {
    let idx = 0;
    const results = [
      { data: { status: "voting", correct_player_id: "p3", room_id: "room-1" }, error: null },
      { data: null, error: null },
    ];
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(
      makeRequest({ round_id: "r1", guessed_player_id: "p2" })
    );

    expect(res.status).toBe(403);
  });

  it("ignores spoofed player_id and uses the authenticated player's membership", async () => {
    let idx = 0;
    const results = [
      { data: { status: "voting", correct_player_id: "p3", room_id: "room-1" }, error: null },
      { data: { id: "real-player" }, error: null },
      {
        data: {
          id: "vote-1",
          round_id: "r1",
          player_id: "real-player",
          guessed_player_id: "p2",
        },
        error: null,
      },
      { data: [{ id: "real-player" }, { id: "p2" }], error: null },
      { count: 1, data: null, error: null },
    ];
    const adminResults = [
      {
        data: {
          id: "vote-1",
          round_id: "r1",
          player_id: "real-player",
          guessed_player_id: "p2",
        },
        error: null,
      },
      { data: [{ id: "real-player" }, { id: "p2" }], error: null },
      { count: 1, data: null, error: null },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const r = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(r);
      }),
    } as never);

    const res = await POST(
      makeRequest({
        round_id: "r1",
        player_id: "spoofed-player",
        guessed_player_id: "p2",
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.vote.player_id).toBe("real-player");
  });

  it("returns 400 when guessed_player_id is missing", async () => {
    const res = await POST(
      makeRequest({ round_id: "r1" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when round is not in voting status", async () => {
    let idx = 0;
    const results = [
      // round lookup - not found or not voting
      { data: null, error: { code: "PGRST116" } },
    ];
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => makeChain({ data: null, error: null })) } as never);

    const res = await POST(
      makeRequest({ round_id: "r1", guessed_player_id: "p2" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/voting/i);
  });

  it("returns 400 when player has already voted (unique violation)", async () => {
    let idx = 0;
    const results = [
      { data: { status: "voting", correct_player_id: "p3", room_id: "room-1" }, error: null },
      { data: { id: "real-player" }, error: null },
      // insert vote - unique violation
      { data: null, error: { code: "23505", message: "unique" } },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const adminResults = [{ data: null, error: { code: "23505", message: "unique" } }];
        const r = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(r);
      }),
    } as never);

    const res = await POST(
      makeRequest({ round_id: "r1", guessed_player_id: "p2" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already voted/i);
  });

  it("casts vote successfully", async () => {
    const vote = { id: "vote-1", round_id: "r1", player_id: "real-player", guessed_player_id: "p2" };
    let idx = 0;
    const results = [
      { data: { status: "voting", correct_player_id: "p3", room_id: "room-1" }, error: null },
      { data: { id: "real-player" }, error: null },
    ];
    let adminIdx = 0;
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const adminResults = [
          { data: vote, error: null },
          { data: [{ id: "real-player" }, { id: "p2" }], error: null },
          { count: 1, data: null, error: null },
        ];
        const r = adminResults[adminIdx] || { data: null, error: null };
        adminIdx += 1;
        return makeChain(r);
      }),
    } as never);

    const res = await POST(
      makeRequest({ round_id: "r1", guessed_player_id: "p2" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.vote.id).toBe("vote-1");
  });
});
