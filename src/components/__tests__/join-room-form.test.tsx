import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinRoomForm } from "@/components/join-room-form";
import { mockDict } from "@/__tests__/helpers/dict-mock";

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

function storeProfile() {
  localStorage.setItem(
    "tfyoulike_profile",
    JSON.stringify({
      nickname: "Bob",
      color: "#34c759",
      tiktok: "likedvideos",
    })
  );
}

describe("JoinRoomForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("redirects to home profile setup when no stored profile exists", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} />);

    expect(mockReplace).toHaveBeenCalledWith("/en?profile=edit");
  });

  it("shows the stored profile summary", () => {
    storeProfile();

    render(<JoinRoomForm lang="en" dict={mockDict} />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("@likedvideos")).toBeInTheDocument();
  });

  it("renders PIN input, stored profile summary, and submit button", () => {
    storeProfile();

    render(<JoinRoomForm lang="en" dict={mockDict} />);
    expect(screen.getByLabelText(mockDict.join.pin)).toBeInTheDocument();
    expect(screen.getByText(mockDict.profile.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: mockDict.join.join })
    ).toBeInTheDocument();
  });

  it("keeps the submit button pinned to the bottom of the form column", () => {
    storeProfile();

    render(<JoinRoomForm lang="en" dict={mockDict} />);

    expect(screen.getByRole("button", { name: mockDict.join.join })).toHaveClass(
      "mt-auto"
    );
  });

  it("submit is disabled when PIN and nickname are empty", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} />);
    const btn = screen.getByRole("button", { name: mockDict.join.join });
    expect(btn).toBeDisabled();
  });

  it("submit is disabled when PIN is less than 4 digits", async () => {
    const user = userEvent.setup();
    storeProfile();
    render(<JoinRoomForm lang="en" dict={mockDict} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "12");

    const btn = screen.getByRole("button", { name: mockDict.join.join });
    expect(btn).toBeDisabled();
  });

  it("enables submit when PIN is valid and a stored profile exists", async () => {
    const user = userEvent.setup();
    storeProfile();
    render(<JoinRoomForm lang="en" dict={mockDict} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");

    const btn = screen.getByRole("button", { name: mockDict.join.join });
    expect(btn).not.toBeDisabled();
  });

  it("accepts initialPin prop", () => {
    render(<JoinRoomForm lang="en" dict={mockDict} initialPin="5678" />);
    const pinInput = screen.getByLabelText(mockDict.join.pin) as HTMLInputElement;
    expect(pinInput.value).toBe("5678");
  });

  it("strips non-numeric characters from PIN input", async () => {
    const user = userEvent.setup();
    storeProfile();
    render(<JoinRoomForm lang="en" dict={mockDict} />);

    const pinInput = screen.getByLabelText(mockDict.join.pin) as HTMLInputElement;
    await user.type(pinInput, "12ab34");
    expect(pinInput.value).toBe("1234");
  });

  it("shows error on API failure", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Room not found or game already started" }),
    }) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "9999");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(
        screen.getByText("Room not found or game already started")
      ).toBeInTheDocument();
    });
  });

  it("navigates to room on success", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          room: { pin: "1234" },
          player: { id: "p2", session_token: "tok2" },
        }),
    }) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/en/room/1234");
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          pin: "1234",
          nickname: "Bob",
          color: "#34c759",
          tiktok_username: "likedvideos",
        }),
      })
    );
  });

  it("shows connection error on fetch throw", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("oops")) as never;

    render(<JoinRoomForm lang="en" dict={mockDict} />);

    await user.type(screen.getByLabelText(mockDict.join.pin), "1234");
    await user.click(screen.getByRole("button", { name: mockDict.join.join }));

    await waitFor(() => {
      expect(screen.getByText("Connection error. Please try again.")).toBeInTheDocument();
    });
  });
});
