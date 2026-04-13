import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/rounds/next/route";

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
  return new Request("http://localhost/api/rooms/1234/rounds/next", {
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

describe("POST /api/rooms/[pin]/rounds/next", () => {
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

  it("returns 403 when non-host tries to advance", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 1, settings: { total_rounds: 9 } };

    mockClients({
      userId: "auth-user-2",
      userResults: [
        { data: room, error: null },
        { data: { id: "p2", user_id: "auth-user-2" }, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "not-host" }), { params });
    expect(res.status).toBe(403);
  });

  it("ignores spoofed player_id and authorizes the authenticated host", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 2, settings: { total_rounds: 9 } };
    const existingRound = { id: "round-3", round_number: 3, status: "voting" };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
      ],
      adminResults: [
        { data: existingRound, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "spoofed-host" }), { params });
    expect(res.status).toBe(200);
  });

  it("finishes game when nextRound > totalRounds", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 9, settings: { total_rounds: 9 } };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
      ],
      adminResults: [{ data: null, error: null }],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.finished).toBe(true);
  });

  it("finishes game when no more videos", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 3, settings: { total_rounds: 9 } };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
      ],
      adminResults: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.finished).toBe(true);
  });

  it("returns an existing next round instead of creating a duplicate", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      host_player_id: "host",
      current_round: 2,
      settings: { total_rounds: 9 },
    };
    const existingRound = { id: "round-3", round_number: 3, status: "voting" };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
      ],
      adminResults: [
        { data: existingRound, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.round).toEqual(existingRound);
  });

  it("advances to next round successfully using stored video URLs", async () => {
    const room = { id: "r1", pin: "1234", status: "playing", host_player_id: "host", current_round: 2, settings: { total_rounds: 9 } };
    const nextVideo = {
      id: "v3",
      player_id: "p2",
      tiktok_url: "https://www.tiktok.com/@foo/video/3",
      video_url: "https://cdn.example.com/3.mp4",
      video_urls: [],
      planned_round_number: 3,
    };
    const newRound = { id: "round-3", round_number: 3, status: "voting" };

    mockClients({
      userId: "auth-host",
      userResults: [
        { data: room, error: null },
        { data: { id: "host", user_id: "auth-host" }, error: null },
      ],
      adminResults: [
        { data: null, error: null },
        { data: nextVideo, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: newRound, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.round.round_number).toBe(3);
  });
});
