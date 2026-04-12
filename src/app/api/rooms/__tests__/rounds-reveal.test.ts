import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/rounds/reveal/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

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

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/rounds/reveal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when room not found", async () => {
    const sb = {
      from: vi.fn(() => makeChain({ data: null, error: { message: "not found" } })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-host tries to reveal", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const sb = {
      from: vi.fn(() => makeChain({ data: room, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "imposter" }), { params });
    expect(res.status).toBe(403);
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

    let idx = 0;
    const results = [
      // room lookup
      { data: room, error: null },
      // round lookup (voting)
      { data: round, error: null },
      // votes
      { data: votes, error: null },
      // update vote 1 is_correct
      { data: null, error: null },
      // update vote 2 is_correct
      { data: null, error: null },
      // fetch current players for score update
      { data: [{ id: "p2", score: 0 }], error: null },
      // update player score
      { data: null, error: null },
      // update round status
      { data: null, error: null },
      // get updated players
      { data: players, error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.correct_player_id).toBe("p1");
    expect(json.votes).toHaveLength(2);
    expect(json.score_deltas).toBeDefined();
    expect(json.players).toHaveLength(3);
  });

  it("handles already-revealed round gracefully", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const existingRound = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "reveal" };

    let idx = 0;
    const results = [
      // room lookup
      { data: room, error: null },
      // round lookup (no voting round found)
      { data: null, error: { code: "PGRST116" } },
      // fetch existing round
      { data: existingRound, error: null },
      // players
      { data: [{ id: "p1", score: 5 }], error: null },
      // votes
      { data: [], error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already_revealed).toBe(true);
  });

  it("returns already_revealed when another request wins the reveal transition", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1 };
    const round = { id: "round-1", room_id: "r1", round_number: 1, correct_player_id: "p1", status: "voting" };
    const votes = [{ id: "v1", player_id: "p2", guessed_player_id: "p1", created_at: "2025-01-01T00:00:00Z" }];

    let idx = 0;
    const results = [
      { data: room, error: null },
      { data: round, error: null },
      { data: votes, error: null },
      { data: null, error: null },
      { data: [{ id: "p2", score: 0 }], error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [{ id: "p1", score: 0 }, { id: "p2", score: 10 }], error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already_revealed).toBe(true);
  });
});
