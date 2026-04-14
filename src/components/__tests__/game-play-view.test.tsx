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

const TEST_USER_ID = "auth-user-1";

function makeAuthUser() {
  return { id: TEST_USER_ID, email: "alice@example.com" };
}

function makeSupabaseMock(overrides: {
  room: Record<string, unknown>;
  players: Record<string, unknown>[];
  round: Record<string, unknown>;
  video: Record<string, unknown>;
  votes?: Array<{ player_id: string; guessed_player_id: string }>;
}) {
  const authGetUser = vi.fn().mockResolvedValue({ data: { user: makeAuthUser() } });

  const supabase = {
    auth: { getUser: authGetUser },
    from: vi.fn((table: string) => {
      const responses: Record<string, { data: unknown; error: unknown; count?: number | null }> = {
        rooms: { data: overrides.room, error: null },
        players: { data: overrides.players, error: null },
        rounds: { data: overrides.round, error: null },
        videos: { data: overrides.video, error: null },
        votes: { data: overrides.votes ?? [], error: null },
      };

      return makeChain(
        responses[table] || { data: null, error: null }
      );
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

function makeRoom() {
  return {
    id: "r1",
    pin: "1234",
    status: "playing",
    current_round: 1,
    settings: { total_rounds: 3 },
  };
}

function makeRound() {
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
  };
}

function makeVideo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "video-1",
    room_id: "r1",
    player_id: "p1",
    tiktok_url: "https://www.tiktok.com/@alice/video/1",
    video_url: "https://example.com/video.mp4",
    video_urls: ["https://example.com/video.mp4"],
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
      expect(videoElement?.className).toContain("h-full");
      expect(videoElement?.className).toContain("w-auto");
      expect(videoElement?.className).toContain("max-w-none");
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

  it("renders fullscreen stage with voting controls docked in bottom bar", async () => {
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

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Alice/i })).toBeInTheDocument();
    });

    const main = container.querySelector("main");
    expect(main?.className).toContain("h-dvh");
    expect(main?.className).toContain("w-screen");

    const votingDock = screen.getByTestId("voting-dock");
    expect(votingDock.className).toContain("rounded-3xl");
    expect(votingDock.className).toContain("backdrop-blur-md");
  });

  it("shows reveal overlay first, then animated round scoreboard", async () => {
    storeSession("p1", "1234");

    const nativeSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 2400) {
          return nativeSetTimeout(handler, 0, ...args);
        }
        return nativeSetTimeout(handler, timeout, ...args);
      }) as typeof setTimeout);

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

    const fetchSpy = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rounds/reveal")) {
        return {
          ok: true,
          json: async () => ({
            correct_player_id: "p1",
            votes: [
              { player_id: "p1", guessed_player_id: "p1", is_correct: true },
              { player_id: "p2", guessed_player_id: "p1", is_correct: true },
            ],
            score_deltas: { p1: 12, p2: 10 },
            players: [
              { ...players[0], score: 12 },
              { ...players[1], score: 10 },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    vi.stubGlobal(
      "fetch",
      fetchSpy
    );

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    const revealButton = await screen.findByRole("button", {
      name: /skip to reveal/i,
    });
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/rounds/reveal"),
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByTestId("reveal-overlay")).toBeInTheDocument();

    try {
      expect(await screen.findByTestId("round-scoreboard")).toBeInTheDocument();
      expect(screen.getByText(/#1 Alice/i)).toBeInTheDocument();
      expect(screen.getByText(/#2 Bob/i)).toBeInTheDocument();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  }, 15000);

  it("shows who is still missing a vote after you already voted", async () => {
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
      makePlayer({
        id: "p3",
        user_id: "auth-user-3",
        nickname: "Cara",
        color: "#34c759",
        is_host: false,
        tiktok_username: "cara",
      }),
    ];

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players,
      round: makeRound(),
      video: makeVideo(),
      votes: [
        { player_id: "p1", guessed_player_id: "p2" },
        { player_id: "p2", guessed_player_id: "p1" },
      ],
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByText(/vote locked/i)).toBeInTheDocument();
      expect(screen.getByText(/waiting for votes from:/i)).toBeInTheDocument();
      expect(screen.getByText(/Cara/i)).toBeInTheDocument();
    });
  });

  it("keeps the player choice order stable even when scores change", async () => {
    storeSession("p1", "1234");

    const players = [
      makePlayer({ id: "p1", nickname: "Alice", score: 0, created_at: "2025-01-01T00:00:00Z" }),
      makePlayer({
        id: "p2",
        user_id: "auth-user-2",
        nickname: "Bob",
        color: "#007aff",
        is_host: false,
        score: 30,
        created_at: "2025-01-01T00:00:01Z",
        tiktok_username: "bob",
      }),
      makePlayer({
        id: "p3",
        user_id: "auth-user-3",
        nickname: "Cara",
        color: "#34c759",
        is_host: false,
        score: 10,
        created_at: "2025-01-01T00:00:02Z",
        tiktok_username: "cara",
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

    const votingDock = await screen.findByTestId("voting-dock");
    const labels = Array.from(votingDock.querySelectorAll("span.truncate")).map((element) =>
      element.textContent?.trim()
    );

    expect(labels).toEqual([
      "Alice",
      "Bob",
      "Cara",
    ]);
  });

  it("shows skip consensus state and remaining players before a unanimous skip", async () => {
    storeSession("p1", "1234");

    const players = [
      makePlayer({ id: "p1", nickname: "Alice", created_at: "2025-01-01T00:00:00Z" }),
      makePlayer({
        id: "p2",
        user_id: "auth-user-2",
        nickname: "Bob",
        color: "#007aff",
        is_host: false,
        created_at: "2025-01-01T00:00:01Z",
        tiktok_username: "bob",
      }),
      makePlayer({
        id: "p3",
        user_id: "auth-user-3",
        nickname: "Cara",
        color: "#34c759",
        is_host: false,
        created_at: "2025-01-01T00:00:02Z",
        tiktok_username: "cara",
      }),
    ];

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players,
      round: makeRound(),
      video: makeVideo(),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);

    const fetchSpy = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rounds/skip") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            all_skipped: false,
            finished: false,
            skip_count: 1,
            player_count: 3,
            skipped_player_ids: ["p1"],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchSpy);

    render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    fireEvent.click(await screen.findByRole("button", { name: /skip video/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /undo skip/i })).toBeInTheDocument();
      expect(screen.getByText(/skip votes: 1\/3/i)).toBeInTheDocument();
      expect(screen.getByText(/waiting for skips from:\s*bob, cara/i)).toBeInTheDocument();
    });
  });

  it("retries a different video candidate when metadata loads with no image dimensions", async () => {
    storeSession("p1", "1234");

    const supabase = makeSupabaseMock({
      room: makeRoom(),
      players: [makePlayer()],
      round: makeRound(),
      video: makeVideo({
        video_url: "https://example.com/video-a.mp4",
        video_urls: ["https://example.com/video-a.mp4", "https://example.com/video-b.mp4"],
      }),
    });

    vi.mocked(createClient).mockReturnValue(supabase as never);
    vi.mocked(requestVideoDataUri)
      .mockResolvedValueOnce("blob:video-a")
      .mockResolvedValueOnce("blob:video-b");

    const { container } = render(<GamePlayView lang="pl" pin="1234" dict={mockDict} />);

    const videoElement = await waitFor(() => {
      const element = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(element).not.toBeNull();
      return element;
    });

    Object.defineProperty(videoElement as HTMLVideoElement, "videoWidth", {
      configurable: true,
      get: () => 0,
    });
    Object.defineProperty(videoElement as HTMLVideoElement, "videoHeight", {
      configurable: true,
      get: () => 0,
    });

    fireEvent.loadedMetadata(videoElement as HTMLVideoElement);

    await waitFor(() => {
      expect(requestVideoDataUri).toHaveBeenNthCalledWith(2, "https://example.com/video-b.mp4");
      const refreshedVideo = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(refreshedVideo?.getAttribute("src")).toBe("blob:video-b");
    });
  });
});
