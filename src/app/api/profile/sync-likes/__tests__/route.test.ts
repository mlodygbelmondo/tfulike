import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { POST } from "@/app/api/profile/sync-likes/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/profile/sync-likes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeChain(resolveValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      if (prop in target) return target[prop as keyof typeof target];
      const fn = vi.fn(() => proxy);
      target[prop as string] = fn;
      return fn;
    },
  });
  return proxy;
}

describe("POST /api/profile/sync-likes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    const response = await POST(
      makeRequest({ tiktok_username: "alice", likes: [] })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when the payload is missing required fields", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as never);

    const response = await POST(makeRequest({ likes: [] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing required fields: tiktok_username, likes[]",
    });
  });

  it("syncs likes and updates profile state on success", async () => {
    const profileSelect = makeChain({ data: { id: "user-1" }, error: null });
    const profileSyncingUpdate = makeChain({ data: null, error: null });
    const likesUpsert = makeChain({ data: null, error: null }) as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    const profileSyncedUpdate = makeChain({ data: null, error: null });
    const playerUpdate = makeChain({ data: null, error: null });

    const upsertSpy = vi.fn(() => likesUpsert);
    likesUpsert.upsert = upsertSpy;

    const profileSyncingUpdateSpy = vi.fn(() => profileSyncingUpdate);
    (profileSyncingUpdate as Record<string, ReturnType<typeof vi.fn>>).update =
      profileSyncingUpdateSpy;

    const profileSyncedUpdateSpy = vi.fn(() => profileSyncedUpdate);
    (profileSyncedUpdate as Record<string, ReturnType<typeof vi.fn>>).update =
      profileSyncedUpdateSpy;

    const playerUpdateSpy = vi.fn(() => playerUpdate);
    (playerUpdate as Record<string, ReturnType<typeof vi.fn>>).update = playerUpdateSpy;

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as never);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(profileSelect)
        .mockReturnValueOnce(profileSyncingUpdate)
        .mockReturnValueOnce(likesUpsert)
        .mockReturnValueOnce(profileSyncedUpdate)
        .mockReturnValueOnce(playerUpdate),
    } as never);

    const response = await POST(
      makeRequest({
        tiktok_username: "lider_drenazu",
        likes: [
          {
            tiktok_video_id: "video-1",
            tiktok_url: "https://www.tiktok.com/@lider_drenazu/video/video-1",
            video_url: "https://cdn.example.com/video-1.mp4",
            video_urls: ["https://cdn.example.com/video-1.mp4"],
            author_username: "lider_drenazu",
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      synced_count: 1,
      tiktok_username: "lider_drenazu",
    });

    expect(upsertSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: "user-1",
          tiktok_video_id: "video-1",
          author_username: "lider_drenazu",
        }),
      ],
      {
        onConflict: "user_id,tiktok_video_id",
        ignoreDuplicates: false,
      }
    );

    expect(profileSyncingUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: "syncing",
        sync_error: null,
        tiktok_username: "lider_drenazu",
      })
    );

    expect(profileSyncedUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: "synced",
        sync_error: null,
        tiktok_username: "lider_drenazu",
      })
    );

    expect(playerUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: "synced",
        sync_error: null,
        tiktok_username: "lider_drenazu",
      })
    );
  });
});
