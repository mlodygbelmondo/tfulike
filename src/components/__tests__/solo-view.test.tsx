import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SoloView } from "@/components/solo-view";
import { mockDict } from "@/__tests__/helpers/dict-mock";
import { SESSION_KEY } from "@/lib/game";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/extension", () => ({
  checkExtensionPresent: vi.fn(() => Promise.resolve(null)),
  requestVideoRefresh: vi.fn(),
  requestVideoDataUri: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { requestVideoDataUri } from "@/lib/extension";

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

function makeLike(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "like-1",
    user_id: "user-1",
    tiktok_video_id: "video-1",
    tiktok_url: "https://www.tiktok.com/@alice/video/1",
    video_url: "https://example.com/video-1.mp4",
    video_urls: ["https://example.com/video-1.mp4"],
    author_username: "alice",
    description: "test",
    cover_url: null,
    created_at: "2025-01-01",
    ...overrides,
  };
}

function makeSupabaseMock(likes: Record<string, unknown>[]) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === "user_likes") {
        return makeChain({ data: likes, error: null });
      }

      return makeChain({ data: null, error: null });
    }),
  };
}

describe("SoloView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestVideoDataUri).mockImplementation(async (url: string) => `blob:${url}`);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    );
  });

  it("loads the first solo video via the extension bridge", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([makeLike()]) as never
    );

    const { container } = render(<SoloView dict={mockDict} />);

    await waitFor(() => {
      const videoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(videoElement).not.toBeNull();
      expect(requestVideoDataUri).toHaveBeenCalledWith("https://example.com/video-1.mp4");
      expect(videoElement?.getAttribute("src")).toBe("blob:https://example.com/video-1.mp4");
    });
  });

  it("moves forward to a new random like and can move back through history", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([
        makeLike(),
        makeLike({
          id: "like-2",
          tiktok_video_id: "video-2",
          tiktok_url: "https://www.tiktok.com/@bob/video/2",
          video_url: "https://example.com/video-2.mp4",
          video_urls: ["https://example.com/video-2.mp4"],
          author_username: "bob",
        }),
      ]) as never
    );

    const { container } = render(<SoloView dict={mockDict} />);

    await waitFor(() => {
      expect(requestVideoDataUri).toHaveBeenCalledWith("https://example.com/video-1.mp4");
    });

    fireEvent.click(screen.getByRole("button", { name: /next video/i }));

    await waitFor(() => {
      expect(requestVideoDataUri).toHaveBeenCalledWith("https://example.com/video-2.mp4");
      const videoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(videoElement?.getAttribute("src")).toBe("blob:https://example.com/video-2.mp4");
    });

    fireEvent.click(screen.getByRole("button", { name: /previous video/i }));

    await waitFor(() => {
      const videoElement = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(videoElement?.getAttribute("src")).toBe("blob:https://example.com/video-1.mp4");
    });
  });

  it("auto-advances to the next video when playback ends", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([
        makeLike(),
        makeLike({
          id: "like-2",
          tiktok_video_id: "video-2",
          tiktok_url: "https://www.tiktok.com/@bob/video/2",
          video_url: "https://example.com/video-2.mp4",
          video_urls: ["https://example.com/video-2.mp4"],
          author_username: "bob",
        }),
      ]) as never
    );

    const { container } = render(<SoloView dict={mockDict} />);

    const firstVideo = await waitFor(() => {
      const videoElements = container.querySelectorAll(
        'video:not([aria-hidden="true"])'
      ) as NodeListOf<HTMLVideoElement>;
      const active = Array.from(videoElements).find(
        (element) => element.getAttribute("src") === "blob:https://example.com/video-1.mp4"
      );
      expect(active).toBeTruthy();
      return active;
    });

    fireEvent.ended(firstVideo as HTMLVideoElement);

    await waitFor(() => {
      const videoElements = container.querySelectorAll(
        'video:not([aria-hidden="true"])'
      ) as NodeListOf<HTMLVideoElement>;
      const active = Array.from(videoElements).find(
        (element) => element.getAttribute("src") === "blob:https://example.com/video-2.mp4"
      );
      expect(active).toBeTruthy();
    });
  });

  it("can hide and restore the bottom controls", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([makeLike()]) as never
    );

    render(<SoloView dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hide controls/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /hide controls/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /next video/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show controls/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /show controls/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /next video/i })).toBeInTheDocument();
    });
  });

  it("keeps manual mode on current video end", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([
        makeLike(),
        makeLike({
          id: "like-2",
          tiktok_video_id: "video-2",
          tiktok_url: "https://www.tiktok.com/@bob/video/2",
          video_url: "https://example.com/video-2.mp4",
          video_urls: ["https://example.com/video-2.mp4"],
          author_username: "bob",
        }),
      ]) as never
    );

    const { container } = render(<SoloView dict={mockDict} />);

    const firstVideo = await waitFor(() => {
      const videoElements = container.querySelectorAll(
        'video:not([aria-hidden="true"])'
      ) as NodeListOf<HTMLVideoElement>;
      const active = Array.from(videoElements).find(
        (element) => element.getAttribute("src") === "blob:https://example.com/video-1.mp4"
      );
      expect(active).toBeTruthy();
      return active;
    });

    fireEvent.click(screen.getByRole("button", { name: /playback mode: hands-free/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /playback mode: manual/i })).toBeInTheDocument();
    });

    fireEvent.ended(firstVideo as HTMLVideoElement);

    await waitFor(() => {
      const videoElements = container.querySelectorAll(
        'video:not([aria-hidden="true"])'
      ) as NodeListOf<HTMLVideoElement>;
      const active = Array.from(videoElements).find(
        (element) => element.getAttribute("src") === "blob:https://example.com/video-1.mp4"
      );
      expect(active).toBeTruthy();
    });
  });

  it("shows only the compact restore control when panel is hidden", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([makeLike()]) as never
    );

    render(<SoloView dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hide controls/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /hide controls/i }));

    const showControlsButton = await screen.findByRole("button", { name: /show controls/i });
    const floatingContainer = showControlsButton.closest("div");
    expect(floatingContainer).not.toBeNull();

    const controls = within(floatingContainer as HTMLElement).queryAllByRole("button");
    expect(controls).toHaveLength(1);
  });

  it("opens the current TikTok in a new tab", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([makeLike()]) as never
    );

    render(<SoloView dict={mockDict} />);

    const openSpy = vi.mocked(window.open);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /open on tiktok/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /open on tiktok/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.tiktok.com/@alice/video/1",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("deletes the session via API and signs the user out", async () => {
    const supabase = makeSupabaseMock([makeLike()]);
    vi.mocked(createClient).mockReturnValue(supabase as never);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId: "p1", roomPin: "1234" }));

    render(<SoloView dict={mockDict} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete session/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /delete session/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/profile/delete-session", {
        method: "POST",
      });
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
  });

  it("retries a different candidate when metadata indicates a black-frame video", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSupabaseMock([
        makeLike({
          video_url: "https://example.com/video-1a.mp4",
          video_urls: [
            "https://example.com/video-1a.mp4",
            "https://example.com/video-1b.mp4",
          ],
        }),
      ]) as never
    );

    vi.mocked(requestVideoDataUri)
      .mockResolvedValueOnce("blob:https://example.com/video-1a.mp4")
      .mockResolvedValueOnce("blob:https://example.com/video-1b.mp4");

    const { container } = render(<SoloView dict={mockDict} />);

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
      expect(requestVideoDataUri).toHaveBeenNthCalledWith(2, "https://example.com/video-1b.mp4");
      const refreshedVideo = container.querySelector(
        'video:not([aria-hidden="true"])'
      ) as HTMLVideoElement | null;
      expect(refreshedVideo?.getAttribute("src")).toBe(
        "blob:https://example.com/video-1b.mp4"
      );
    });
  });
});
