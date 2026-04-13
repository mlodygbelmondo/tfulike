import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinRoomForm } from "@/components/join-room-form";
import { mockDict } from "@/__tests__/helpers/dict-mock";
import type { Profile } from "@/lib/types";

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

const testProfile: Profile = {
  id: "user-1",
  nickname: "Bob",
  color: "#34c759",
  avatar_url: null,
  tiktok_username: null,
  sync_status: "idle",
  sync_error: null,
  synced_at: null,
  onboarding_completed: true,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
};

describe("JoinRoomForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the profile summary from the profile prop", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("renders PIN input, profile summary, and submit button", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);
    expect(screen.getByLabelText(mockDict.join.pin)).toBeInTheDocument();
    expect(screen.getByText(mockDict.profile.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: mockDict.join.join })
    ).toBeInTheDocument();
  });

  it("keeps the submit button pinned to the bottom of the form column", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    expect(screen.getByRole("button", { name: mockDict.join.join })).toHaveClass(
      "mt-auto"
    );
  });

  it("submit is disabled when PIN is less than 4 digits", async () => {
    const user = userEvent.setup();
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "12");

    const btn = screen.getByRole("button", { name: mockDict.join.join });
    expect(btn).toBeDisabled();
  });

  it("enables submit when PIN is valid and profile exists", async () => {
    const user = userEvent.setup();
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");

    const btn = screen.getByRole("button", { name: mockDict.join.join });
    expect(btn).not.toBeDisabled();
  });

  it("accepts initialPin prop", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} initialPin="5678" />);
    const pinInput = screen.getByLabelText(mockDict.join.pin) as HTMLInputElement;
    expect(pinInput.value).toBe("5678");
  });

  it("strips non-numeric characters from PIN input", async () => {
    const user = userEvent.setup();
    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    const pinInput = screen.getByLabelText(mockDict.join.pin) as HTMLInputElement;
    await user.type(pinInput, "12ab34");
    expect(pinInput.value).toBe("1234");
  });

  it("shows error on API failure", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Room not found or game already started" }),
    }) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "9999");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(
        screen.getByText("Room not found or game already started")
      ).toBeInTheDocument();
    });
  });

  it("navigates to room on success and stores session", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          room: { pin: "1234" },
          player: { id: "p2" },
        }),
    }) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/en/room/1234");
    });

    // Verify session was stored with new shape
    const stored = JSON.parse(localStorage.getItem("tfulike_session") || "{}");
    expect(stored.playerId).toBe("p2");
    expect(stored.roomPin).toBe("1234");

    // Auth-based: API receives only pin (profile comes from server-side auth)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pin: "1234" }),
      })
    );
  });

  it("shows connection error on fetch throw", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("oops")) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} profile={testProfile} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(screen.getByText("Connection error. Please try again.")).toBeInTheDocument();
    });
  });
});
