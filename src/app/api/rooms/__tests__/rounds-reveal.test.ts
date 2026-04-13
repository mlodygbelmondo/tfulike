import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/rounds/reveal/route";

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
  return new Request("http://localhost/api/rooms/1234/rounds/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockClients({
  userId,
  userResults,
  adminResults,
}: {
  userId: string | null;
  userResults?: Array<{ data: unknown; error: unknown }>;
  adminResults?: Array<{ data: unknown; error: unknown }>;
}) {
  let userIdx = 0;
  let adminIdx = 0;

  vi.mocked(createClient).mockResolvedValue({
    auth: makeAuthMock(userId),
    from: vi.fn(() => {
      const result = userResults?.[userIdx] ?? { data: null, error: null };
      userIdx += 1;
      return makeChain(result);
    }),
  } as never);

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => {
      const result = adminResults?.[adminIdx] ?? { data: null, error: null };
      adminIdx += 1;
      return makeChain(result);
    }),
  } as never);
}

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/rounds/reveal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when user is not authenticated", async () => {
    mockClients({ userId: null });

    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when room not found", async () => {
    mockClients({
      userId: "auth-host",
      userResults: [{ data: null, error: { message: "not found" } }],
    });

    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-host tries to reveal before all votes are in", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const round = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "voting" };

    mockClients({
      userId: "auth-user-2",
      userResults: [
        { data: room, error: null },
        { data: { id: "p2", user_id: "auth-user-2" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "host" }, { id: "p2" }], error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "imposter" }), { params });
    expect(res.status).toBe(403);
  });

  it("ignores spoofed player_id and authorizes the authenticated host", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const round = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "voting" };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [], error: null },
        { data: [{ id: "round-1" }], error: null },
        { data: [{ id: "host", score: 0 }], error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "spoofed" }), { params });
    expect(res.status).toBe(200);
  });

  it("reveals scores successfully", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const round = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "voting" };
    const votes = [
      { id: "v1", player_id: "p2", guessed_player_id: "p1", created_at: "2025-01-01T00:00:00Z" },
      { id: "v2", player_id: "p3", guessed_player_id: "wrong", created_at: "2025-01-01T00:00:01Z" },
    ];
    const players = [
      { id: "p1", score: 0 },
      { id: "p2", score: 10 },
      { id: "p3", score: 0 },
    ];

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: votes, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: [{ id: "p2", score: 0 }], error: null },
        { data: null, error: null },
        { data: [{ id: "round-1" }], error: null },
        { data: players, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.correct_player_id).toBe("p1");
    expect(json.votes).toHaveLength(2);
    expect(json.players).toHaveLength(3);
  });

  it("handles already-revealed round gracefully", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const existingRound = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "reveal" };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
        { data: null, error: { code: "PGRST116" } },
        { data: existingRound, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1", score: 5 }], error: null },
        { data: [], error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already_revealed).toBe(true);
  });

  it("returns already_revealed when another request wins the reveal transition", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const round = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "voting" };
    const votes = [{ id: "v1", player_id: "p2", guessed_player_id: "p1", created_at: "2025-01-01T00:00:00Z" }];

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: votes, error: null },
        { data: null, error: null },
        { data: [{ id: "p2", score: 0 }], error: null },
        { data: null, error: null },
        { data: [], error: null },
        { data: [{ id: "p1", score: 0 }, { id: "p2", score: 10 }], error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already_revealed).toBe(true);
  });
});
