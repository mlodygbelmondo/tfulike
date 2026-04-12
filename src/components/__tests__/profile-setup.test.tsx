import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSetup } from "@/components/profile-setup";
import { mockDict } from "@/__tests__/helpers/dict-mock";

describe("ProfileSetup", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("syncs active player profile after saving", async () => {
    const user = userEvent.setup();

    localStorage.setItem(
      "tfulike_session",
      JSON.stringify({
        playerId: "player-1",
        sessionToken: "session-token",
        roomPin: "1234",
      })
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ player: { id: "player-1" } }),
    }) as never;

    render(<ProfileSetup dict={mockDict} forceOpen />);

    await user.type(screen.getByLabelText(mockDict.profile.nickname), "Alice");
    await user.type(screen.getByLabelText(mockDict.profile.tiktok), "@cooluser");
    await user.click(screen.getByRole("button", { name: mockDict.profile.save }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/players/profile",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            player_id: "player-1",
            session_token: "session-token",
            room_pin: "1234",
            nickname: "Alice",
            color: "#ff2d55",
            tiktok_username: "cooluser",
          }),
        })
      );
    });
  });
});
