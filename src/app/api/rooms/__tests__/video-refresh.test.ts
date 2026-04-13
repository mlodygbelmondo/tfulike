import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/videos/[id]/refresh/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

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

describe("POST /api/videos/[id]/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    const sb = {
      auth: makeAuthMock(null),
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      new Request("http://localhost/api/videos/v1/refresh", { method: "POST" }),
      { params: Promise.resolve({ id: "v1" }) }
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when video not found", async () => {
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => makeChain({ data: null, error: { message: "not found" } })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      new Request("http://localhost/api/videos/v1/refresh", { method: "POST" }),
      { params: Promise.resolve({ id: "v1" }) }
    );

    expect(res.status).toBe(404);
  });

  it("returns current video data without external API calls", async () => {
    const videoData = {
      id: "v1",
      tiktok_url: "https://www.tiktok.com/@foo/video/1",
      video_url: "https://example.com/1.mp4",
      room_id: "r1",
      player_id: "p1",
      used: false,
    };
    const sb = {
      auth: makeAuthMock("auth-user-1"),
      from: vi.fn(() => makeChain({ data: videoData, error: null })),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      new Request("http://localhost/api/videos/v1/refresh", { method: "POST" }),
      { params: Promise.resolve({ id: "v1" }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.video.id).toBe("v1");
    expect(json.video.video_url).toBe("https://example.com/1.mp4");
  });
});
