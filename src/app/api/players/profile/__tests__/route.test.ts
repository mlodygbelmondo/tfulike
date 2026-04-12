import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/players/profile/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

function makeChain(resolveValue: { data: unknown; error: unknown }) {
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

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/players/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/players/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the active player's profile", async () => {
    const player = {
      id: "player-1",
      room_id: "room-1",
      session_token: "session-token",
      nickname: "Old",
      color: "#ff2d55",
      tiktok_username: "olduser",
    };
    const room = { id: "room-1", pin: "1234", status: "lobby" };
    const updatedPlayer = {
      ...player,
      nickname: "Alice",
      color: "#5856d6",
      tiktok_username: "cooluser",
    };

    let idx = 0;
    const results = [
      { data: player, error: null },
      { data: room, error: null },
      { data: updatedPlayer, error: null },
    ];
    const updateSpy = vi.fn();
    const sb = {
      from: vi.fn((table: string) => {
        const r = results[idx] || { data: null, error: null };
        idx++;
        const chain = makeChain(r) as Record<string, ReturnType<typeof vi.fn>>;
        if (table === "players") {
          chain.update = updateSpy.mockReturnValue(chain);
        }
        return chain;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(sb as never);

    const res = await POST(
      makeRequest({
        player_id: "player-1",
        session_token: "session-token",
        room_pin: "1234",
        nickname: " Alice ",
        color: "#5856d6",
        tiktok_username: "@cooluser",
      })
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({
      nickname: "Alice",
      color: "#5856d6",
      tiktok_username: "cooluser",
    });
  });
});
