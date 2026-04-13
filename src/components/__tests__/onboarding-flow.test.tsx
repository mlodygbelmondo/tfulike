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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: {} }) });
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
          }),
        }
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/profile",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sync_status: "synced",
            tiktok_username: "resolved.from.extension",
          }),
        })
      );
    });
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
});
