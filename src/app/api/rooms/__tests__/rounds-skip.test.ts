import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, POST } from "@/app/api/rooms/[pin]/rounds/skip/route";

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

function makeRequest(method: "POST" | "DELETE") {
  return new Request("http://localhost/api/rooms/1234/rounds/skip", {
    method,
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

describe("/api/rooms/[pin]/rounds/skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a skip vote without replacing the round before unanimity", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 2,
      settings: { total_rounds: 5 },
    };
    const round = {
      id: "round-2",
      room_id: "r1",
      round_number: 2,
      video_id: "video-current",
      correct_player_id: "p1",
      status: "voting",
    };

    mockClients({
      userId: "auth-p1",
      userResults: [
        { data: room, error: null },
        { data: { id: "p1", user_id: "auth-p1" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], error: null },
        { data: { id: "skip-1", round_id: "round-2", player_id: "p1" }, error: null },
        { data: [{ player_id: "p1" }], error: null },
      ],
    });

    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.all_skipped).toBe(false);
    expect(json.skip_count).toBe(1);
    expect(json.player_count).toBe(3);
  });

  it("replaces the current round video and shortens the game after unanimous skip", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 2,
      settings: { total_rounds: 5 },
    };
    const round = {
      id: "round-2",
      room_id: "r1",
      round_number: 2,
      video_id: "video-current",
      correct_player_id: "p1",
      status: "voting",
    };
    const replacementVideo = {
      id: "video-next",
      player_id: "p2",
      planned_round_number: 3,
    };

    mockClients({
      userId: "auth-p3",
      userResults: [
        { data: room, error: null },
        { data: { id: "p3", user_id: "auth-p3" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], error: null },
        { data: { id: "skip-3", round_id: "round-2", player_id: "p3" }, error: null },
        { data: [{ player_id: "p1" }, { player_id: "p2" }, { player_id: "p3" }], error: null },
        { data: replacementVideo, error: null },
        {
          data: [
            { id: "video-later-1", planned_round_number: 4 },
            { id: "video-later-2", planned_round_number: 5 },
          ],
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.all_skipped).toBe(true);
    expect(json.replacement_applied).toBe(true);
    expect(json.finished).toBe(false);
    expect(json.replacement_video_id).toBe("video-next");
  });

  it("finishes the game when the round is skipped unanimously without a replacement", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 5,
      settings: { total_rounds: 5 },
    };
    const round = {
      id: "round-5",
      room_id: "r1",
      round_number: 5,
      video_id: "video-current",
      correct_player_id: "p1",
      status: "voting",
    };

    mockClients({
      userId: "auth-p2",
      userResults: [
        { data: room, error: null },
        { data: { id: "p2", user_id: "auth-p2" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1" }, { id: "p2" }], error: null },
        { data: { id: "skip-2", round_id: "round-5", player_id: "p2" }, error: null },
        { data: [{ player_id: "p1" }, { player_id: "p2" }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.all_skipped).toBe(true);
    expect(json.finished).toBe(true);
    expect(json.replacement_applied).toBe(false);
  });

  it("removes a skip vote when the player toggles it off", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 2,
      settings: { total_rounds: 5 },
    };
    const round = {
      id: "round-2",
      room_id: "r1",
      round_number: 2,
      video_id: "video-current",
      correct_player_id: "p1",
      status: "voting",
    };

    mockClients({
      userId: "auth-p1",
      userResults: [
        { data: room, error: null },
        { data: { id: "p1", user_id: "auth-p1" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], error: null },
        { data: null, error: null },
        { data: [{ player_id: "p2" }], error: null },
      ],
    });

    const res = await DELETE(makeRequest("DELETE"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.all_skipped).toBe(false);
    expect(json.skip_count).toBe(1);
    expect(json.player_count).toBe(3);
  });

  it("returns 500 when the guarded round claim fails", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 2,
      settings: { total_rounds: 5 },
    };
    const round = {
      id: "round-2",
      room_id: "r1",
      round_number: 2,
      video_id: "video-current",
      correct_player_id: "p1",
      status: "voting",
    };
    const replacementVideo = {
      id: "video-next",
      player_id: "p2",
      planned_round_number: 3,
    };

    mockClients({
      userId: "auth-p3",
      userResults: [
        { data: room, error: null },
        { data: { id: "p3", user_id: "auth-p3" }, error: null },
        { data: round, error: null },
      ],
      adminResults: [
        { data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], error: null },
        { data: { id: "skip-3", round_id: "round-2", player_id: "p3" }, error: null },
        { data: [{ player_id: "p1" }, { player_id: "p2" }, { player_id: "p3" }], error: null },
        { data: replacementVideo, error: null },
        { data: [], error: { message: "claim failed" } },
      ],
    });

    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to resolve skip");
  });
});
