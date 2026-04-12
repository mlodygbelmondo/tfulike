import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateRoomForm } from "@/components/create-room-form";
import { mockDict } from "@/__tests__/helpers/dict-mock";

// Mock fetch
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
      nickname: "Alice",
      color: "#5856d6",
      tiktok: "cooluser",
    })
  );
}

describe("CreateRoomForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("redirects to home profile setup when no stored profile exists", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} />);

    expect(mockReplace).toHaveBeenCalledWith("/en?profile=edit");
  });

  it("shows the stored profile summary", () => {
    storeProfile();

    render(<CreateRoomForm lang="en" dict={mockDict} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@cooluser")).toBeInTheDocument();
  });

  it("renders stored profile summary and submit button", () => {
    storeProfile();

    render(<CreateRoomForm lang="en" dict={mockDict} />);
    expect(screen.getByText(mockDict.profile.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: mockDict.create.create })
    ).toBeInTheDocument();
  });

  it("submit button is disabled when nickname is empty", () => {
    render(<CreateRoomForm lang="en" dict={mockDict} />);
    const btn = screen.getByRole("button", { name: mockDict.create.create });
    expect(btn).toBeDisabled();
  });

  it("submit button enables when a stored profile exists", () => {
    storeProfile();

    render(<CreateRoomForm lang="en" dict={mockDict} />);

    const btn = screen.getByRole("button", { name: mockDict.create.create });
    expect(btn).not.toBeDisabled();
  });

  it("renders the stored color chip", () => {
    storeProfile();

    render(<CreateRoomForm lang="en" dict={mockDict} />);
    expect(screen.getByText(mockDict.profile.pickColor)).toBeInTheDocument();
    expect(screen.getByLabelText("Stored color #5856d6")).toBeInTheDocument();
  });

  it("shows error when API returns an error", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Failed to create room" }),
    }) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} />);

    const btn = screen.getByRole("button", { name: mockDict.create.create });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText("Failed to create room")).toBeInTheDocument();
    });
  });

  it("navigates to room on success and stores session", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          room: { pin: "4567", id: "r1" },
          player: { id: "p1", session_token: "tok" },
        }),
    }) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} />);

    const btn = screen.getByRole("button", { name: mockDict.create.create });
    await user.click(btn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/en/room/4567");
    });

    // Verify session was stored
    const stored = JSON.parse(localStorage.getItem("tfyoulike_session") || "{}");
    expect(stored.playerId).toBe("p1");
    expect(stored.roomPin).toBe("4567");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          nickname: "Alice",
          color: "#5856d6",
          tiktok_username: "cooluser",
        }),
      })
    );
  });

  it("shows connection error on fetch failure", async () => {
    const user = userEvent.setup();
    storeProfile();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as never;

    render(<CreateRoomForm lang="en" dict={mockDict} />);
    await user.click(screen.getByRole("button", { name: mockDict.create.create }));

    await waitFor(() => {
      expect(screen.getByText("Connection error. Please try again.")).toBeInTheDocument();
    });
  });
});
