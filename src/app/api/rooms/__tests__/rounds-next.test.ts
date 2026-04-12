import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/rounds/next/route";

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
  return new Request("http://localhost/api/rooms/1234/rounds/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/rounds/next", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when room not found", async () => {
    const sb = {
      from: vi.fn(() => makeChain({ data: null, error: { message: "not found" } })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-host tries to advance", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1, settings: { total_rounds: 9 } };
    const sb = {
      from: vi.fn(() => makeChain({ data: room, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "not-host" }), { params });
    expect(res.status).toBe(403);
  });

  it("finishes game when nextRound > totalRounds", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 9, settings: { total_rounds: 9 } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // update room status to finished
      { data: null, error: null },
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
    expect(json.finished).toBe(true);
  });

  it("finishes game when no more videos", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 3, settings: { total_rounds: 9 } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // unused videos query returns empty array
      { data: [], error: null },
      // update room finished
      { data: null, error: null },
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
    expect(json.finished).toBe(true);
  });

  it("advances to next round successfully using stored video URLs", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 2, settings: { total_rounds: 9 } };
    const newRound = { id: "round-3", round_number: 3, status: "voting" };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // unused videos
      { data: [{ id: "v3", player_id: "p2", tiktok_url: "https://www.tiktok.com/@foo/video/3", video_url: "https://cdn.example.com/3.mp4" }], error: null },
      // mark video used
      { data: null, error: null },
      // mark current round done
      { data: null, error: null },
      // create new round
      { data: newRound, error: null },
      // update room current_round
      { data: null, error: null },
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
    expect(json.finished).toBe(false);
    expect(json.round.round_number).toBe(3);
  });
});
