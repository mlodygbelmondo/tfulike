import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { mockDict } from "@/__tests__/helpers/dict-mock";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockRequestExtensionSync = vi.fn();
const mockCheckExtensionPresent = vi.fn();
vi.mock("@/lib/extension", () => ({
  requestExtensionSync: (...args: unknown[]) => mockRequestExtensionSync(...args),
  checkExtensionPresent: (...args: unknown[]) => mockCheckExtensionPresent(...args),
  normalizeExtensionSyncError: (error?: string) => {
    if (
      error?.includes("Cannot access contents of the page") ||
      error?.includes("must request permission to access the respective host")
    ) {
      return "Couldn't access your TikTok tab. Make sure TikTok is open in this Chrome profile, the tab is fully loaded, you're logged in, and the extension is allowed on tiktok.com, then try again.";
    }

    return error;
  },
}));

describe("OnboardingFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExtensionPresent.mockResolvedValue("1.0.0");
  });

  it("stores the username returned by the extension sync", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, synced_count: 1 }) });
    globalThis.fetch = fetchMock as never;

    mockRequestExtensionSync.mockResolvedValue({
      ok: true,
      tiktok_username: "resolved.from.extension",
      likes: [
        {
          tiktok_video_id: "video-1",
          tiktok_url: "https://www.tiktok.com/@resolved.from.extension/video/video-1",
          video_url: "https://cdn.example.com/video-1.mp4",
        },
      ],
    });

    render(
      <OnboardingFlow
        lang="en"
        dict={mockDict}
        initialProfile={{
          nickname: "Alice",
          color: "#5856d6",
          avatar_url: null,
          tiktok_username: null,
          sync_status: "idle",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: mockDict.onboarding.next }));

    await waitFor(() => {
      expect(mockCheckExtensionPresent).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: mockDict.onboarding.syncLikes }));

    await waitFor(() => {
      expect(mockRequestExtensionSync).toHaveBeenCalledWith({});
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/profile/sync-likes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tiktok_username: "resolved.from.extension",
            likes: [
              {
                tiktok_video_id: "video-1",
                tiktok_url: "https://www.tiktok.com/@resolved.from.extension/video/video-1",
                video_url: "https://cdn.example.com/video-1.mp4",
              },
            ],
            bookmarks: [],
          }),
        }
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the edge function error body instead of the generic wrapper message", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: {} }),
    }).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "User profile not found" }),
    });
    globalThis.fetch = fetchMock as never;

    mockRequestExtensionSync.mockResolvedValue({
      ok: true,
      tiktok_username: "resolved.from.extension",
      likes: [],
    });

    render(
      <OnboardingFlow
        lang="en"
        dict={mockDict}
        initialProfile={{
          nickname: "Alice",
          color: "#5856d6",
          avatar_url: null,
          tiktok_username: null,
          sync_status: "idle",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: mockDict.onboarding.next }));
    await user.click(screen.getByRole("button", { name: mockDict.onboarding.syncLikes }));

    expect(await screen.findByText("User profile not found")).toBeInTheDocument();
  });

  it("shows a friendlier message for Chrome host-permission sync failures", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: {} }),
    });
    globalThis.fetch = fetchMock as never;

    mockRequestExtensionSync.mockResolvedValue({
      ok: false,
      error:
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
    });

    render(
      <OnboardingFlow
        lang="en"
        dict={mockDict}
        initialProfile={{
          nickname: "Alice",
          color: "#5856d6",
          avatar_url: null,
          tiktok_username: null,
          sync_status: "idle",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: mockDict.onboarding.next }));
    await user.click(screen.getByRole("button", { name: mockDict.onboarding.syncLikes }));

    expect(
      await screen.findByText(
        "Couldn't access your TikTok tab. Make sure TikTok is open in this Chrome profile, the tab is fully loaded, you're logged in, and the extension is allowed on tiktok.com, then try again."
      )
    ).toBeInTheDocument();
  });

  it("does not send a redundant profile sync-status write after sync-likes succeeds", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, synced_count: 1 }) });
    globalThis.fetch = fetchMock as never;

    mockRequestExtensionSync.mockResolvedValue({
      ok: true,
      tiktok_username: "resolved.from.extension",
      likes: [
        {
          tiktok_video_id: "video-1",
          tiktok_url: "https://www.tiktok.com/@resolved.from.extension/video/video-1",
          video_url: "https://cdn.example.com/video-1.mp4",
        },
      ],
      bookmarks: [],
    });

    render(
      <OnboardingFlow
        lang="en"
        dict={mockDict}
        initialProfile={{
          nickname: "Alice",
          color: "#5856d6",
          avatar_url: null,
          tiktok_username: null,
          sync_status: "idle",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: mockDict.onboarding.next }));
    await user.click(screen.getByRole("button", { name: mockDict.onboarding.syncLikes }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/profile/sync-likes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          tiktok_username: "resolved.from.extension",
          likes: [
            {
              tiktok_video_id: "video-1",
              tiktok_url: "https://www.tiktok.com/@resolved.from.extension/video/video-1",
              video_url: "https://cdn.example.com/video-1.mp4",
            },
          ],
          bookmarks: [],
        }),
      })
    );
  });
});
