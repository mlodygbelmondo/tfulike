import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rooms/[pin]/start/route";

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
  return new Request("http://localhost/api/rooms/1234/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ pin: "1234" });

describe("POST /api/rooms/[pin]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when room not found", async () => {
    let idx = 0;
    const results = [{ data: null, error: { message: "not found" } }];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-host tries to start", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: null } };
    let idx = 0;
    const results = [{ data: room, error: null }];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "not-host" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when fewer than 2 players", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: null } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // players (only 1)
      { data: [{ id: "p1", tiktok_username: "user1", nickname: "Alice", sync_status: "synced" }], error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host-1" }), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/2 players/i);
  });

  it("returns 400 when not all players have synced", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: null } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      { data: [
        { id: "p1", tiktok_username: "user1", nickname: "Alice", sync_status: "synced" },
        { id: "p2", tiktok_username: "user2", nickname: "Bob", sync_status: "idle" },
        { id: "p3", tiktok_username: "user3", nickname: "Carol", sync_status: "synced" },
      ], error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host-1" }), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Bob");
    expect(json.error).toMatch(/synced/i);
  });

  it("returns 400 when no likes found", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: null } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // players — all synced
      { data: [
        { id: "p1", tiktok_username: "user1", nickname: "Alice", sync_status: "synced" },
        { id: "p2", tiktok_username: "user2", nickname: "Bob", sync_status: "synced" },
      ], error: null },
      // likes query returns empty
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

    const res = await POST(makeRequest({ player_id: "host-1" }), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/synced likes/i);
  });

  it("starts game successfully using synced likes", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: 3 } };
    const round = { id: "round-1", round_number: 1, status: "voting" };
    const insertedVideos = [
      {
        id: "v1",
        player_id: "p1",
        tiktok_url: "https://tiktok.com/@user1/video/1",
        tiktok_video_id: "1",
        video_url: "https://example.com/1.mp4",
        planned_round_number: 1,
      },
    ];
    let idx = 0;
    const results = [
      { data: room, error: null },
      // players
      { data: [
        { id: "p1", tiktok_username: "user1", nickname: "Alice", sync_status: "synced" },
        { id: "p2", tiktok_username: "user2", nickname: "Bob", sync_status: "synced" },
      ], error: null },
      // likes
      { data: [
        { player_id: "p1", tiktok_url: "https://tiktok.com/@user1/video/1", video_url: "https://example.com/1.mp4", tiktok_video_id: "1" },
        { player_id: "p1", tiktok_url: "https://tiktok.com/@user1/video/2", video_url: "https://example.com/2.mp4", tiktok_video_id: "2" },
        { player_id: "p2", tiktok_url: "https://tiktok.com/@user2/video/3", video_url: "https://example.com/3.mp4", tiktok_video_id: "3" },
        { player_id: "p2", tiktok_url: "https://tiktok.com/@user2/video/4", video_url: "https://example.com/4.mp4", tiktok_video_id: "4" },
      ], error: null },
      // delete existing videos
      { data: null, error: null },
      // insert videos
      { data: insertedVideos, error: null },
      // mark first video used
      { data: null, error: null },
      // create round
      { data: round, error: null },
      // update room
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

    const res = await POST(makeRequest({ player_id: "host-1" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.round).toBeDefined();
    expect(json.totalRounds).toBeGreaterThan(0);
  });

  it("returns 400 when a player has no likes", async () => {
    const room = { id: "r1", pin: "1234", status: "lobby", host_player_id: "host-1", settings: { max_rounds: null } };
    let idx = 0;
    const results = [
      { data: room, error: null },
      // players
      { data: [
        { id: "p1", tiktok_username: "user1", nickname: "Alice", sync_status: "synced" },
        { id: "p2", tiktok_username: "user2", nickname: "Bob", sync_status: "synced" },
      ], error: null },
      // likes — only p1 has likes, p2 has none
      { data: [
        { player_id: "p1", tiktok_url: "https://tiktok.com/@user1/video/1", video_url: "https://example.com/1.mp4", tiktok_video_id: "1" },
      ], error: null },
    ];
    const sb = {
      from: vi.fn(() => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        return makeChain(r);
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ player_id: "host-1" }), { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Bob");
    expect(json.error).toMatch(/sync again/i);
  });
});
