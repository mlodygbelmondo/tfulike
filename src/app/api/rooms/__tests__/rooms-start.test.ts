import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/start/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

const HOST_USER_ID = "auth-host-1";
const OTHER_USER_ID = "auth-other-2";

function makeAuthMock(userId: string | null) {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { user: userId ? { id: userId } : null },
    }),
  };
}

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/rooms/1234/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockClients({
  userId,
  roomResult,
  adminResults,
}: {
  userId: string | null;
  roomResult?: { data: unknown; error: unknown };
  adminResults?: Array<{ data: unknown; error: unknown }>;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: makeAuthMock(userId),
    from: vi.fn(() => makeChain(roomResult ?? { data: null, error: null })),
  } as never);

  let adminIdx = 0;
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => {
      const result = adminResults?.[adminIdx] ?? { data: null, error: null };
      adminIdx += 1;
      return makeChain(result);
    }),
  } as never);
}

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockClients({ userId: null });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when room not found", async () => {
    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: null, error: { message: "not found" } },
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-host tries to start", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: null },
    };

    mockClients({
      userId: OTHER_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
            { id: "p2", user_id: OTHER_USER_ID, nickname: "Bob", sync_status: "synced" },
          ],
          error: null,
        },
      ],
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when fewer than 2 players", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: null },
    };

    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
          ],
          error: null,
        },
      ],
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/2 players/i);
  });

  it("returns 400 when not all players have synced", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: null },
    };

    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
            { id: "p2", user_id: OTHER_USER_ID, nickname: "Bob", sync_status: "synced" },
          ],
          error: null,
        },
        {
          data: [
            { id: HOST_USER_ID, sync_status: "synced", nickname: "Alice" },
            { id: OTHER_USER_ID, sync_status: "idle", nickname: "Bob" },
          ],
          error: null,
        },
      ],
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Bob");
  });

  it("returns 400 when no likes found in user_likes", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: null },
    };

    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
            { id: "p2", user_id: OTHER_USER_ID, nickname: "Bob", sync_status: "synced" },
          ],
          error: null,
        },
        {
          data: [
            { id: HOST_USER_ID, sync_status: "synced", nickname: "Alice" },
            { id: OTHER_USER_ID, sync_status: "synced", nickname: "Bob" },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/synced likes/i);
  });

  it("starts game successfully using global user_likes", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: 3 },
    };
    const round = { id: "round-1", round_number: 1, status: "voting" };
    const insertedVideos = [
      {
        id: "v1",
        player_id: "host-1",
        tiktok_url: "https://tiktok.com/@user1/video/1",
        tiktok_video_id: "1",
        video_url: "https://example.com/1.mp4",
        planned_round_number: 1,
      },
    ];

    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
            { id: "p2", user_id: OTHER_USER_ID, nickname: "Bob", sync_status: "synced" },
          ],
          error: null,
        },
        {
          data: [
            { id: HOST_USER_ID, sync_status: "synced", nickname: "Alice" },
            { id: OTHER_USER_ID, sync_status: "synced", nickname: "Bob" },
          ],
          error: null,
        },
        {
          data: [
            { user_id: HOST_USER_ID, tiktok_url: "https://tiktok.com/@user1/video/1", video_url: "https://example.com/1.mp4", tiktok_video_id: "1", video_urls: [] },
            { user_id: HOST_USER_ID, tiktok_url: "https://tiktok.com/@user1/video/2", video_url: "https://example.com/2.mp4", tiktok_video_id: "2", video_urls: [] },
            { user_id: OTHER_USER_ID, tiktok_url: "https://tiktok.com/@user2/video/3", video_url: "https://example.com/3.mp4", tiktok_video_id: "3", video_urls: [] },
            { user_id: OTHER_USER_ID, tiktok_url: "https://tiktok.com/@user2/video/4", video_url: "https://example.com/4.mp4", tiktok_video_id: "4", video_urls: [] },
          ],
          error: null,
        },
        { data: null, error: null },
        { data: insertedVideos, error: null },
        { data: null, error: null },
        { data: round, error: null },
        { data: null, error: null },
      ],
    });

    const res = await POST(makeRequest({ player_id: "spoofed-host" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.round).toBeDefined();
    expect(json.totalRounds).toBeGreaterThan(0);
  });

  it("returns 400 when a player has no likes in user_likes", async () => {
    const room = {
      id: "r1",
      pin: "1234",
      status: "lobby",
      host_player_id: "host-1",
      settings: { max_rounds: null },
    };

    mockClients({
      userId: HOST_USER_ID,
      roomResult: { data: room, error: null },
      adminResults: [
        {
          data: [
            { id: "host-1", user_id: HOST_USER_ID, nickname: "Alice", sync_status: "synced" },
            { id: "p2", user_id: OTHER_USER_ID, nickname: "Bob", sync_status: "synced" },
          ],
          error: null,
        },
        {
          data: [
            { id: HOST_USER_ID, sync_status: "synced", nickname: "Alice" },
            { id: OTHER_USER_ID, sync_status: "synced", nickname: "Bob" },
          ],
          error: null,
        },
        {
          data: [
            { user_id: HOST_USER_ID, tiktok_url: "https://tiktok.com/@user1/video/1", video_url: "https://example.com/1.mp4", tiktok_video_id: "1", video_urls: [] },
          ],
          error: null,
        },
      ],
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Bob");
    expect(json.error).toMatch(/sync again/i);
  });
});
