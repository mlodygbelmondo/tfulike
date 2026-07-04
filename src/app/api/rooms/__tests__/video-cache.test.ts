import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/videos/[id]/cache/route";

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
  return new Request("http://localhost/api/videos/video-1/cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "video-1" });

function mockAuthUser(user: { id: string } | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  } as never);
}

function mockAdmin(
  results: Array<{ data: unknown; error: unknown }>,
  storage?: Record<string, unknown>,
) {
  let idx = 0;
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => {
      const result = results[idx] || { data: null, error: null };
      idx += 1;
      return makeChain(result);
    }),
    storage: {
      from: vi.fn(() => storage ?? {}),
    },
  } as never);
}

describe("POST /api/videos/[id]/cache", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid actions", async () => {
    mockAuthUser({ id: "auth-host" });
    mockAdmin([]);

    const res = await POST(makeRequest({ action: "nope" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuthUser(null);
    mockAdmin([]);

    const res = await POST(makeRequest({ action: "upload-url" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not the host", async () => {
    mockAuthUser({ id: "auth-guest" });
    mockAdmin([
      { data: { id: "video-1", room_id: "room-1" }, error: null },
      { data: { id: "room-1", host_player_id: "host-player" }, error: null },
      { data: { id: "guest-player" }, error: null },
    ]);

    const res = await POST(makeRequest({ action: "upload-url" }), { params });
    expect(res.status).toBe(403);
  });

  it("gives the host a signed upload URL and marks the video uploading", async () => {
    mockAuthUser({ id: "auth-host" });
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl: "https://storage.example.com/upload?token=abc",
        token: "abc",
        path: "room-1/video-1.mp4",
      },
      error: null,
    });
    mockAdmin(
      [
        { data: { id: "video-1", room_id: "room-1" }, error: null },
        { data: { id: "room-1", host_player_id: "host-player" }, error: null },
        { data: { id: "host-player" }, error: null },
        { data: null, error: null }, // cache_status update
      ],
      { createSignedUploadUrl },
    );

    const res = await POST(makeRequest({ action: "upload-url" }), { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.upload.signedUrl).toBe(
      "https://storage.example.com/upload?token=abc",
    );
    expect(json.upload.path).toBe("room-1/video-1.mp4");
    expect(createSignedUploadUrl).toHaveBeenCalledWith("room-1/video-1.mp4", {
      upsert: true,
    });
  });

  it("marks the video ready on complete", async () => {
    mockAuthUser({ id: "auth-host" });
    const readyVideo = {
      id: "video-1",
      room_id: "room-1",
      cache_status: "ready",
      storage_path: "room-1/video-1.mp4",
    };
    mockAdmin([
      { data: { id: "video-1", room_id: "room-1" }, error: null },
      { data: { id: "room-1", host_player_id: "host-player" }, error: null },
      { data: { id: "host-player" }, error: null },
      { data: readyVideo, error: null },
    ]);

    const res = await POST(makeRequest({ action: "complete" }), { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.video.cache_status).toBe("ready");
    expect(json.video.storage_path).toBe("room-1/video-1.mp4");
  });
});

describe("GET /api/videos/[id]/cache", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the video is not cached", async () => {
    mockAdmin([
      {
        data: {
          id: "video-1",
          room_id: "room-1",
          cache_status: "pending",
          storage_path: null,
        },
        error: null,
      },
    ]);

    const res = await GET(new Request("http://localhost"), { params });
    expect(res.status).toBe(404);
  });

  it("returns a signed URL for a cached video", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example.com/signed/video-1.mp4" },
      error: null,
    });
    mockAdmin(
      [
        {
          data: {
            id: "video-1",
            room_id: "room-1",
            cache_status: "ready",
            storage_path: "room-1/video-1.mp4",
          },
          error: null,
        },
      ],
      { createSignedUrl },
    );

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://storage.example.com/signed/video-1.mp4");
    expect(createSignedUrl).toHaveBeenCalledWith("room-1/video-1.mp4", 3600);
  });
});
