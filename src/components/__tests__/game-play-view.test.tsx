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
  requestMediaDataUri: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import {
  checkExtensionPresent,
  requestMediaDataUri,
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

const TEST_USER_ID = "auth-user-1";

function makeAuthUser() {
  return { id: TEST_USER_ID, email: "alice@example.com" };
}

function makeSupabaseMock(overrides: {
  room: Record<string, unknown>;
  players: Record<string, unknown>[];
  round: Record<string, unknown>;
  video: Record<string, unknown>;
  prefetchedVideo?: Record<string, unknown> | null;
}) {
  let votesCallIndex = 0;
  let videosCallIndex = 0;
  const authGetUser = vi.fn().mockResolvedValue({ data: { user: makeAuthUser() } });

  const supabase = {
    auth: { getUser: authGetUser },
    from: vi.fn((table: string) => {
      const responses: Record<string, Array<{ data: unknown; error: unknown; count?: number | null }>> = {
        rooms: [{ data: overrides.room, error: null }],
        players: [{ data: overrides.players, error: null }],
        rounds: [{ data: overrides.round, error: null }],
        videos: [
          { data: overrides.video, error: null },
          { data: overrides.prefetchedVideo ?? null, error: null },
        ],
        votes: [
          { data: null, error: null },
          { data: null, error: null, count: 0 },
        ],
      };

      const queue = responses[table];
        const index =
          table === "votes"
            ? votesCallIndex++
            : table === "videos"
              ? videosCallIndex++
              : 0;
        return makeChain(queue?.[index] || { data: null, error: null });
      }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    })),
    removeChannel: vi.fn(),
  };

  return supabase;
}

function storeSession(playerId: string, roomPin: string) {
  localStorage.setItem(
    "tfulike_session",
    JSON.stringify({ playerId, roomPin })
  );
}

function makePlayer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    room_id: "r1",
    user_id: TEST_USER_ID,
    nickname: "Alice",
    color: "#ff2d55",
    is_host: true,
    score: 0,
    videos_ready: true,
    tiktok_username: "alice",
    sync_status: "synced",
    sync_error: null,
    synced_at: null,
    created_at: "2025-01-01",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    pin: "1234",
    status: "playing",
    current_round: 1,
    settings: { total_rounds: 3 },
    ...overrides,
  };
}

function makeRound(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "round-1",
    room_id: "r1",
    round_number: 1,
    video_id: "video-1",
    correct_player_id: "p1",
    status: "voting",
    deadline: null,
    started_at: "2025-01-01",
    ended_at: null,
    ...overrides,
  };
}

function makeVideo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "video-1",
    room_id: "r1",
    player_id: "p1",
    tiktok_url: "https://www.tiktok.com/@alice/video/1",
    media_type: "video",
    video_url: "https://example.com/video.mp4",
    video_urls: ["https://example.com/video.mp4"],
    image_urls: [],
    audio_url: null,
    cover_url: null,
    used: true,
    created_at: "2025-01-01",
    ...overrides,
  };
}

describe("GamePlayView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(requestVideoDataUri).mockResolvedValue("blob:mock-video");
    vi.mocked(requestMediaDataUri).mockResolvedValue("blob:mock-audio");
  });

  it("shows the current player as a voting option", async () => {
    storeSession("p1", "1234");

    const players = [
      makePlayer(),
      makePlayer({
        id: "p2",
        user_id: "auth-user-2",
        nickname: "Bob",
        color: "#007aff",
        is_host: false,
        tiktok_username: "bob",
      }),
    ];

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players,
      round: makeRound(),
      video: makeVideo(),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Alice/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Bob/i })).toBeInTheDocument();
    });
  });

  it("loads the initial video playback source through the extension data fetcher", async () => {
    storeSession("p1", "1234");

    const rawVideoUrl = "https://www.tiktok.com/video/example.mp4?foo=bar";
    const dataUri = "blob:initial-video";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({ video_url: rawVideoUrl, video_urls: [rawVideoUrl] }),
    });

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
    storeSession("p1", "1234");

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo(),
    });

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
    storeSession("p1", "1234");

    let resolveVideo: ((value: string) => void) | undefined;
    vi.mocked(requestVideoDataUri).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVideo = resolve;
        })
    );

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo(),
    });

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
    storeSession("p1", "1234");

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo(),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tap to mute" })).toBeInTheDocument();
    });
  });

  it("falls back to muted playback when autoplay with sound is blocked", async () => {
    storeSession("p1", "1234");

    const playMock = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"))
      .mockResolvedValue(undefined);

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo(),
    });

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
    storeSession("p1", "1234");

    vi.mocked(checkExtensionPresent).mockResolvedValue("0.1.0");
    vi.mocked(requestVideoRefresh).mockResolvedValue({
      ok: true,
      video_urls: ["https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar"],
    });

    const initialRawVideoUrl = "https://www.tiktok.com/video/expired.mp4?foo=bar";
    const refreshedRawVideoUrl =
      "https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar";
    const initialDataUri = "blob:expired-video";
    const refreshedDataUri = "blob:refreshed-video";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({
        tiktok_url: "https://www.tiktok.com/@alice/video/1234567890",
        video_url: initialRawVideoUrl,
        video_urls: [initialRawVideoUrl],
      }),
    });

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

    expect(vi.mocked(requestVideoDataUri).mock.calls).toEqual([
      [initialRawVideoUrl],
      [refreshedRawVideoUrl],
    ]);
  });

  it("never falls back to a raw TikTok URL after a video element error", async () => {
    storeSession("p1", "1234");

    vi.mocked(checkExtensionPresent).mockResolvedValue("0.1.0");
    vi.mocked(requestVideoRefresh).mockResolvedValue({
      ok: true,
      video_urls: ["https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar"],
    });

    const initialRawVideoUrl = "https://www.tiktok.com/video/expired.mp4?foo=bar";
    const refreshedRawVideoUrl =
      "https://v19-webapp-prime.tiktok.com/video/example.mp4?foo=bar";
    const initialDataUri = "blob:expired-video";
    const refreshedDataUri = "blob:refreshed-video";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({
        tiktok_url: "https://www.tiktok.com/@alice/video/1234567890",
        video_url: initialRawVideoUrl,
        video_urls: [initialRawVideoUrl],
      }),
    });

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

  it("does not remount the active video element when the same blob src is reused", async () => {
    storeSession("p1", "1234");

    const players = [
      makePlayer(),
      makePlayer({
        id: "p2",
        user_id: "auth-user-2",
        nickname: "Bob",
        color: "#007aff",
        is_host: false,
        tiktok_username: "bob",
      }),
    ];

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players,
      round: makeRound(),
      video: makeVideo(),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri).mockResolvedValue("blob:stable-video");

    const { container, rerender } = render(
      <GamePlayView lang="pl" pin="1234" dict={mockDict} />
    );

    const initialVideoElement = await waitFor(() => {
      const element = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(element).not.toBeNull();
      return element;
    });

    rerender(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const currentVideoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(currentVideoElement).toBe(initialVideoElement);
    });
  });

  it("renders a photo gallery with simple navigation controls", async () => {
    storeSession("p1", "1234");

    const firstImage = "https://cdn.example.com/photo-1.jpg";
    const secondImage = "https://cdn.example.com/photo-2.jpg";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({
        media_type: "photo_gallery",
        video_url: null,
        video_urls: [],
        image_urls: [firstImage, secondImage],
        audio_url: "https://cdn.example.com/gallery-audio.mp3",
        cover_url: firstImage,
      }),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    const image = await waitFor(() =>
      screen.getByRole("img", { name: "TikTok photo 1 of 2" })
    );
    expect(image).toHaveAttribute("src", firstImage);

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "TikTok photo 2 of 2" })).toHaveAttribute(
        "src",
        secondImage
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "TikTok photo 1 of 2" })).toHaveAttribute(
        "src",
        firstImage
      );
    });
  });

  it("loads photo gallery audio through the extension media fetcher", async () => {
    storeSession("p1", "1234");

    const audioUrl = "https://cdn.example.com/gallery-audio.mp3";
    const audioBlob = "blob:gallery-audio";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({
        media_type: "photo_gallery",
        video_url: null,
        video_urls: [],
        image_urls: ["https://cdn.example.com/photo-1.jpg"],
        audio_url: audioUrl,
        cover_url: "https://cdn.example.com/photo-1.jpg",
      }),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestMediaDataUri).mockResolvedValue(audioBlob);

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const audioElement = container.querySelector("audio") as HTMLAudioElement | null;
      expect(requestMediaDataUri).toHaveBeenCalledWith(audioUrl);
      expect(audioElement).not.toBeNull();
      expect(audioElement?.getAttribute("src")).toBe(audioBlob);
    });
  });

  it("prefetches the next round video while the current round is active", async () => {
    storeSession("p1", "1234");

    const currentVideoUrl = "https://example.com/current-video.mp4";
    const nextVideoUrl = "https://example.com/next-video.mp4";
    const currentBlob = "blob:current-video";
    const nextBlob = "blob:next-video";

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({ video_url: currentVideoUrl, video_urls: [currentVideoUrl] }),
      prefetchedVideo: makeVideo({
        id: "video-2",
        planned_round_number: 2,
        video_url: nextVideoUrl,
        video_urls: [nextVideoUrl],
      }),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri).mockImplementation((url: string) =>
      Promise.resolve(url === nextVideoUrl ? nextBlob : currentBlob)
    );

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      const urls = vi.mocked(requestVideoDataUri).mock.calls.map(([url]) => url);
      expect(urls).toContain(currentVideoUrl);
      expect(urls).toContain(nextVideoUrl);
    });
  });
});
