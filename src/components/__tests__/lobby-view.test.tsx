import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { LobbyView } from "@/components/lobby-view";
import { mockDict } from "@/__tests__/helpers/dict-mock";

const mockPush = vi.fn();
const removeChannel = vi.fn();
const subscribe = vi.fn().mockReturnValue({});
const on = vi.fn().mockReturnThis();
const channel = vi.fn(() => ({ on, subscribe }));
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } });
const from = vi.fn();

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
  checkExtensionPresent: vi.fn().mockResolvedValue(null),
  requestExtensionSync: vi.fn(),
}));

describe("LobbyView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        ])
      );
    });
  });
});
