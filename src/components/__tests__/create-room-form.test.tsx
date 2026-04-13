import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateRoomForm } from "@/components/create-room-form";
import { mockDict } from "@/__tests__/helpers/dict-mock";
import type { Profile } from "@/lib/types";

// Mock fetch
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

const testProfile: Profile = {
  id: "user-1",
  nickname: "Alice",
  color: "#5856d6",
  avatar_url: null,
  tiktok_username: null,
  sync_status: "idle",
  sync_error: null,
  synced_at: null,
  onboarding_completed: true,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
};

describe("CreateRoomForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the profile summary", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("renders profile summary and submit button", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);
    expect(screen.getByText(mockDict.profile.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: mockDict.create.create })
    ).toBeInTheDocument();
  });

  it("keeps the create button pinned to the bottom of the form column", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    expect(screen.getByRole("button", { name: mockDict.create.create })).toHaveClass(
      "mt-auto"
    );
  });

  it("submit button is enabled when profile exists", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);
    const btn = screen.getByRole("button", { name: mockDict.create.create });
    expect(btn).not.toBeDisabled();
  });

  it("shows error when API returns an error", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Failed to create room" }),
    }) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    const btn = screen.getByRole("button", { name: mockDict.create.create });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText("Failed to create room")).toBeInTheDocument();
    });
  });

  it("navigates to room on success and stores session", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          room: { pin: "4567", id: "r1" },
          player: { id: "p1" },
        }),
    }) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    const btn = screen.getByRole("button", { name: mockDict.create.create });
    await user.click(btn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/en/room/4567");
    });

    // Verify session was stored
    const stored = JSON.parse(localStorage.getItem("tfulike_session") || "{}");
    expect(stored.playerId).toBe("p1");
    expect(stored.roomPin).toBe("4567");

    // Auth-based: API receives empty body (profile comes from server-side auth)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      })
    );
  });

  it("shows connection error on fetch failure", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} profile={testProfile} />);
    await user.click(screen.getByRole("button", { name: mockDict.create.create }));

    await waitFor(() => {
      expect(screen.getByText("Connection error. Please try again.")).toBeInTheDocument();
    });
  });
});
