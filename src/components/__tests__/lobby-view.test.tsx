import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LobbyView } from "@/components/lobby-view";
import { mockDict } from "@/__tests__/helpers/dict-mock";

const mockPush = vi.fn();
const removeChannel = vi.fn();
const subscribe = vi.fn().mockReturnValue({});
const on = vi.fn().mockReturnThis();
const channel = vi.fn(() => ({ on, subscribe }));
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } });
const from = vi.fn();
const mockCheckExtensionPresent = vi.fn().mockResolvedValue(null);
const mockRequestExtensionSync = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser },
    from,
    channel,
    removeChannel,
  }),
}));

vi.mock("@/lib/extension", () => ({
  checkExtensionPresent: (...args: unknown[]) =>
    mockCheckExtensionPresent(...args),
  requestExtensionSync: (...args: unknown[]) =>
    mockRequestExtensionSync(...args),
}));

describe("LobbyView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExtensionPresent.mockResolvedValue(null);
    on.mockReturnThis();
    subscribe.mockReturnValue({});

    from.mockImplementation((table: string) => {
      const result =
        table === "rooms"
          ? {
              data: {
                id: "room-1",
                pin: "6386",
                status: "lobby",
                host_player_id: "player-1",
                settings: { max_rounds: null },
              },
              error: null,
            }
          : table === "players"
            ? {
                data: [
                  {
                    id: "player-1",
                    room_id: "room-1",
                    user_id: "user-1",
                    nickname: "Alice",
                    color: "#ff2d55",
                    is_host: true,
                    score: 0,
                    videos_ready: false,
                    tiktok_username: "alice",
                    sync_status: "synced",
                    sync_error: null,
                    synced_at: null,
                    created_at: "2025-01-01",
                  },
                ],
                error: null,
              }
            : { data: null, error: null };

      const chainState: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(chainState, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          if (prop in target) return target[prop as keyof typeof target];
          const fn = vi.fn(() => proxy);
          target[prop as string] = fn;
          return fn;
        },
      });

      return proxy;
    });
  });

  it("subscribes to room-scoped realtime filters", async () => {
    render(<LobbyView lang="en" pin="6386" dict={mockDict} />);

    await waitFor(() => {
      expect(channel).toHaveBeenCalledWith("room:6386");
    });

    await waitFor(() => {
      expect(on.mock.calls).toEqual(
        expect.arrayContaining([
          [
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "rooms",
              filter: "pin=eq.6386",
            },
            expect.any(Function),
          ],
          [
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "players",
              filter: "room_id=eq.room-1",
            },
            expect.any(Function),
          ],
        ]),
      );
    });
  });

  it("shows sync badges and keeps host start disabled until everyone is synced", async () => {
    from.mockImplementation((table: string) => {
      const result =
        table === "rooms"
          ? {
              data: {
                id: "room-1",
                pin: "6386",
                status: "lobby",
                host_player_id: "player-1",
                settings: { max_rounds: null },
              },
              error: null,
            }
          : table === "players"
            ? {
                data: [
                  {
                    id: "player-1",
                    room_id: "room-1",
                    user_id: "user-1",
                    nickname: "Alice",
                    color: "#ff2d55",
                    is_host: true,
                    score: 0,
                    videos_ready: false,
                    tiktok_username: "alice",
                    sync_status: "synced",
                    sync_error: null,
                    synced_at: null,
                    created_at: "2025-01-01",
                  },
                  {
                    id: "player-2",
                    room_id: "room-1",
                    user_id: "user-2",
                    nickname: "Bob",
                    color: "#5856d6",
                    is_host: false,
                    score: 0,
                    videos_ready: false,
                    tiktok_username: null,
                    sync_status: "idle",
                    sync_error: null,
                    synced_at: null,
                    created_at: "2025-01-01",
                  },
                ],
                error: null,
              }
            : { data: null, error: null };

      const chainState: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(chainState, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          if (prop in target) return target[prop as keyof typeof target];
          const fn = vi.fn(() => proxy);
          target[prop as string] = fn;
          return fn;
        },
      });

      return proxy;
    });

    render(<LobbyView lang="en" pin="6386" dict={mockDict} />);

    expect(await screen.findByText(mockDict.lobby.synced)).toBeInTheDocument();
    expect(
      await screen.findByText(mockDict.lobby.syncIdle),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: mockDict.lobby.startGame }),
    ).toBeDisabled();
  });

  it("syncs likes from the lobby and refreshes player state", async () => {
    const user = userEvent.setup();
    const playersByFetch = [
      [
        {
          id: "player-1",
          room_id: "room-1",
          user_id: "user-1",
          nickname: "Alice",
          color: "#ff2d55",
          is_host: true,
          score: 0,
          videos_ready: false,
          tiktok_username: null,
          sync_status: "idle",
          sync_error: null,
          synced_at: null,
          created_at: "2025-01-01",
        },
        {
          id: "player-2",
          room_id: "room-1",
          user_id: "user-2",
          nickname: "Bob",
          color: "#5856d6",
          is_host: false,
          score: 0,
          videos_ready: false,
          tiktok_username: "bob",
          sync_status: "synced",
          sync_error: null,
          synced_at: null,
          created_at: "2025-01-01",
        },
      ],
      [
        {
          id: "player-1",
          room_id: "room-1",
          user_id: "user-1",
          nickname: "Alice",
          color: "#ff2d55",
          is_host: true,
          score: 0,
          videos_ready: false,
          tiktok_username: "alice",
          sync_status: "synced",
          sync_error: null,
          synced_at: null,
          created_at: "2025-01-01",
        },
        {
          id: "player-2",
          room_id: "room-1",
          user_id: "user-2",
          nickname: "Bob",
          color: "#5856d6",
          is_host: false,
          score: 0,
          videos_ready: false,
          tiktok_username: "bob",
          sync_status: "synced",
          sync_error: null,
          synced_at: null,
          created_at: "2025-01-01",
        },
      ],
    ];
    let playersFetchCount = 0;

    from.mockImplementation((table: string) => {
      const result =
        table === "rooms"
          ? {
              data: {
                id: "room-1",
                pin: "6386",
                status: "lobby",
                host_player_id: "player-1",
                settings: { max_rounds: null },
              },
              error: null,
            }
          : table === "players"
            ? {
                data: playersByFetch[
                  Math.min(playersFetchCount++, playersByFetch.length - 1)
                ],
                error: null,
              }
            : { data: null, error: null };

      const chainState: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(chainState, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          if (prop in target) return target[prop as keyof typeof target];
          const fn = vi.fn(() => proxy);
          target[prop as string] = fn;
          return fn;
        },
      });

      return proxy;
    });

    mockCheckExtensionPresent.mockResolvedValue("1.0.0");
    mockRequestExtensionSync.mockResolvedValue({
      ok: true,
      tiktok_username: "alice",
      likes: [
        {
          tiktok_video_id: "video-1",
          tiktok_url: "https://www.tiktok.com/@alice/video/video-1",
          video_url: "https://cdn.example.com/video-1.mp4",
        },
      ],
      bookmarks: [
        {
          tiktok_video_id: "bookmark-1",
          tiktok_url: "https://www.tiktok.com/@alice/video/bookmark-1",
          video_url: "https://cdn.example.com/bookmark-1.mp4",
        },
      ],
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as never;

    render(<LobbyView lang="en" pin="6386" dict={mockDict} />);

    await user.click(
      await screen.findByRole("button", { name: mockDict.lobby.syncLikes }),
    );

    await waitFor(() => {
      expect(mockRequestExtensionSync).toHaveBeenCalledWith({});
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/profile/sync-likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiktok_username: "alice",
          likes: [
            {
              tiktok_video_id: "video-1",
              tiktok_url: "https://www.tiktok.com/@alice/video/video-1",
              video_url: "https://cdn.example.com/video-1.mp4",
            },
          ],
          bookmarks: [
            {
              tiktok_video_id: "bookmark-1",
              tiktok_url: "https://www.tiktok.com/@alice/video/bookmark-1",
              video_url: "https://cdn.example.com/bookmark-1.mp4",
            },
          ],
        }),
      });
    });

    expect(await screen.findAllByText(mockDict.lobby.synced)).not.toHaveLength(
      0,
    );
    expect(
      screen.getByRole("button", { name: mockDict.lobby.startGame }),
    ).toBeEnabled();
  });
});
