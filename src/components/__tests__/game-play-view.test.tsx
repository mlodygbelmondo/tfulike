import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GamePlayView } from "@/components/game-play-view";
import { mockDict } from "@/__tests__/helpers/dict-mock";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/extension", () => ({
  checkExtensionPresent: vi.fn(() => Promise.resolve(null)),
  requestVideoRefresh: vi.fn(),
  requestVideoDataUri: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  checkExtensionPresent,
  requestVideoRefresh,
  requestVideoDataUri,
} from "@/lib/extension";

function makeChain(resolveValue: { data: unknown; error?: unknown; count?: number | null }) {
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

describe("GamePlayView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(requestVideoDataUri).mockResolvedValue("blob:mock-video");
  });

  it("shows the current player as a voting option", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
      {
        id: "p2",
        room_id: "r1",
        nickname: "Bob",
        color: "#007aff",
        session_token: "token-2",
        is_host: false,
        score: 0,
        videos_ready: true,
        tiktok_username: "bob",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: "https://example.com/video.mp4",
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Alice/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Bob/i })).toBeInTheDocument();
    });
  });

  it("loads the initial video playback source through the extension data fetcher", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const rawVideoUrl = "https://www.tiktok.com/video/example.mp4?foo=bar";
    const dataUri = "blob:initial-video";
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: rawVideoUrl,
      video_urls: [rawVideoUrl],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri).mockResolvedValue(dataUri);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const videoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(videoElement).not.toBeNull();
      expect(requestVideoDataUri).toHaveBeenCalledWith(rawVideoUrl);
      expect(videoElement?.getAttribute("src")).toBe(dataUri);
      expect(videoElement?.muted).toBe(false);
      expect(videoElement?.hasAttribute("controls")).toBe(false);
    });
  });

  it("renders contain-mode video inside a centered foreground overlay", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: "https://example.com/video.mp4",
      video_urls: ["https://example.com/video.mp4"],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const videoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(videoElement).not.toBeNull();
      expect(videoElement?.className).toContain("max-h-full");
      expect(videoElement?.className).toContain("max-w-full");
      expect(videoElement?.className).not.toContain("h-full w-full");
      expect(videoElement?.parentElement?.className).toContain("absolute inset-0");
      expect(videoElement?.parentElement?.className).toContain("place-items-center");
    });
  });

  it("shows a loading state instead of unavailable while resolving the video blob", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    let resolveVideo: ((value: string) => void) | undefined;
    vi.mocked(requestVideoDataUri).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVideo = resolve;
        })
    );

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: "https://example.com/video.mp4",
      video_urls: ["https://example.com/video.mp4"],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByText("Loading video...")).toBeInTheDocument();
    });

    expect(screen.queryByText("Video unavailable in this round.")).not.toBeInTheDocument();

    expect(resolveVideo).toBeTypeOf("function");
    resolveVideo?.("blob:loaded-video");

    await waitFor(() => {
      expect(screen.queryByText("Loading video...")).not.toBeInTheDocument();
    });
  });

  it("renders the sound control as tap to mute by default", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: "https://example.com/video.mp4",
      video_urls: ["https://example.com/video.mp4"],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tap to mute" })).toBeInTheDocument();
    });
  });

  it("falls back to muted playback when autoplay with sound is blocked", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    const playMock = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"))
      .mockResolvedValue(undefined);

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1",
      video_url: "https://example.com/video.mp4",
      video_urls: ["https://example.com/video.mp4"],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    const videoElement = await waitFor(() => {
      const element = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(element).not.toBeNull();
      return element;
    });

    fireEvent.canPlay(videoElement as HTMLVideoElement);

    await waitFor(() => {
      expect(playMock).toHaveBeenCalledTimes(2);
      expect(videoElement?.muted).toBe(true);
      expect(screen.getByRole("button", { name: "Tap for sound" })).toBeInTheDocument();
    });

    playMock.mockRestore();
  });

  it("loads refreshed video playback sources through the extension data fetcher", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    vi.mocked(checkExtensionPresent).mockResolvedValue("0.1.0");
    vi.mocked(requestVideoRefresh).mockResolvedValue({
      ok: true,
      video_urls: ["https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar"],
    });

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const initialRawVideoUrl = "https://www.tiktok.com/video/expired.mp4?foo=bar";
    const refreshedRawVideoUrl =
      "https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar";
    const initialDataUri = "blob:expired-video";
    const refreshedDataUri = "blob:refreshed-video";
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1234567890",
      video_url: initialRawVideoUrl,
      video_urls: [initialRawVideoUrl],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri)
      .mockResolvedValueOnce(initialDataUri)
      .mockResolvedValueOnce(refreshedDataUri);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const videoElement = container.querySelector('video:not([aria-hidden="true"])');
      expect(videoElement).not.toBeNull();
      expect(requestVideoDataUri).toHaveBeenCalledWith(initialRawVideoUrl);
      expect(videoElement?.getAttribute("src")).toBe(initialDataUri);
    });

    const initialVideoElement = container.querySelector('video:not([aria-hidden="true"])');
    expect(initialVideoElement).not.toBeNull();
    fireEvent.error(initialVideoElement as HTMLVideoElement);

    await waitFor(() => {
      expect(requestVideoRefresh).toHaveBeenCalledWith({
        tiktok_video_id: "1234567890",
        tiktok_url: "https://www.tiktok.com/@alice/video/1234567890",
      });
      expect(requestVideoDataUri).toHaveBeenCalledWith(refreshedRawVideoUrl);

      const refreshedVideoElement = container.querySelector('video:not([aria-hidden="true"])');
      expect(refreshedVideoElement?.getAttribute("src")).toBe(refreshedDataUri);
    });
  });

  it("never falls back to a raw TikTok URL after a video element error", async () => {
    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({ playerId: "p1", sessionToken: "token", roomPin: "1234" })
    );

    vi.mocked(checkExtensionPresent).mockResolvedValue("0.1.0");
    vi.mocked(requestVideoRefresh).mockResolvedValue({
      ok: true,
      video_urls: ["https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar"],
    });

    let callIndex = 0;
    const room = {
      id: "r1",
      pin: "1234",
      status: "playing",
      current_round: 1,
      settings: { total_rounds: 3 },
    };
    const players = [
      {
        id: "p1",
        room_id: "r1",
        nickname: "Alice",
        color: "#ff2d55",
        session_token: "token",
        is_host: true,
        score: 0,
        videos_ready: true,
        tiktok_username: "alice",
        sync_status: "synced",
        sync_error: null,
        synced_at: null,
        created_at: "2025-01-01",
      },
    ];
    const round = {
      id: "round-1",
      room_id: "r1",
      round_number: 1,
      video_id: "video-1",
      correct_player_id: "p1",
      status: "voting",
      deadline: null,
      started_at: "2025-01-01",
      ended_at: null,
    };
    const initialRawVideoUrl = "https://www.tiktok.com/video/expired.mp4?foo=bar";
    const refreshedRawVideoUrl =
      "https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar";
    const initialDataUri = "blob:expired-video";
    const refreshedDataUri = "blob:refreshed-video";
    const video = {
      id: "video-1",
      room_id: "r1",
      player_id: "p1",
      tiktok_url: "https://www.tiktok.com/@alice/video/1234567890",
      video_url: initialRawVideoUrl,
      video_urls: [initialRawVideoUrl],
      used: true,
      created_at: "2025-01-01",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        const responses = {
          rooms: [{ data: room, error: null }],
          players: [{ data: players, error: null }],
          rounds: [{ data: round, error: null }],
          videos: [{ data: video, error: null }],
          votes: [
            { data: null, error: null },
            { data: null, error: null, count: 0 },
          ],
        } as const;

        const queue = responses[table as keyof typeof responses];
        const index = table === "votes" ? callIndex++ : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      })),
      removeChannel: vi.fn(),
    };

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri)
      .mockResolvedValueOnce(initialDataUri)
      .mockResolvedValueOnce(refreshedDataUri);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const videoElement = container.querySelector('video:not([aria-hidden="true"])');
      expect(videoElement?.getAttribute("src")).toBe(initialDataUri);
    });

    const initialVideoElement = container.querySelector('video:not([aria-hidden="true"])');
    expect(initialVideoElement).not.toBeNull();
    fireEvent.error(initialVideoElement as HTMLVideoElement);

    const transientVideoElement = container.querySelector('video:not([aria-hidden="true"])');
    expect(transientVideoElement?.getAttribute("src")).not.toBe(refreshedRawVideoUrl);

    await waitFor(() => {
      const refreshedVideoElement = container.querySelector('video:not([aria-hidden="true"])');
      expect(refreshedVideoElement?.getAttribute("src")).toBe(refreshedDataUri);
    });
  });
});
