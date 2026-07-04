import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/videos/[id]/sources/route";

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
      if (prop === "then")
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      if (prop in target) return target[prop as keyof typeof target];
      const fn = vi.fn(() => proxy);
      target[prop as string] = fn;
      return fn;
    },
  });
  return proxy;
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/videos/video-1/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "video-1" });

describe("POST /api/videos/[id]/sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => makeChain({ data: null, error: null })),
    } as never);

    const res = await POST(
      makeRequest({ video_urls: ["https://cdn.example.com/a.mp4"] }),
      {
        params,
      },
    );

    expect(res.status).toBe(401);
  });

  it("lets the room host update fresh video URL candidates", async () => {
    let idx = 0;
    const updatedVideo = {
      id: "video-1",
      room_id: "room-1",
      video_url: "https://cdn.example.com/a.mp4",
      video_urls: [
        "https://cdn.example.com/a.mp4",
        "https://cdn.example.com/b.mp4",
      ],
    };
    const results = [
      { data: { id: "video-1", room_id: "room-1" }, error: null },
      { data: { id: "room-1", host_player_id: "host-player" }, error: null },
      { data: { id: "host-player" }, error: null },
      { data: updatedVideo, error: null },
    ];

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "auth-host" } } }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        const result = results[idx] || { data: null, error: null };
        idx += 1;
        return makeChain(result);
      }),
    } as never);

    const res = await POST(
      makeRequest({
        video_url: "https://cdn.example.com/a.mp4",
        video_urls: [
          "https://cdn.example.com/a.mp4",
          "https://cdn.example.com/b.mp4",
        ],
      }),
      { params },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.video.video_url).toBe("https://cdn.example.com/a.mp4");
    expect(json.video.video_urls).toEqual([
      "https://cdn.example.com/a.mp4",
      "https://cdn.example.com/b.mp4",
    ]);
  });
});
