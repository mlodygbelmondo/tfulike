import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRealtimeChannel } from "@/lib/use-realtime-channel";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";

interface MockChannel {
  name: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  handlers: Array<{ config: Record<string, unknown>; handler: () => void }>;
  statusCallback: ((status: string) => void) | null;
}

function makeSupabaseMock() {
  const channels: MockChannel[] = [];
  const removeChannel = vi.fn();

  const channel = vi.fn((name: string) => {
    const mock: MockChannel = {
      name,
      handlers: [],
      statusCallback: null,
      on: vi.fn(
        (
          _type: string,
          config: Record<string, unknown>,
          handler: () => void,
        ) => {
          mock.handlers.push({ config, handler });
          return mock;
        },
      ),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        mock.statusCallback = callback ?? null;
        return mock;
      }),
    };
    channels.push(mock);
    return mock;
  });

  return { supabase: { channel, removeChannel }, channels, removeChannel };
}

describe("useRealtimeChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function setup(overrides: { enabled?: boolean } = {}) {
    const { supabase, channels, removeChannel } = makeSupabaseMock();
    vi.mocked(createClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createClient>,
    );
    const onChange = vi.fn();

    const hook = renderHook(() =>
      useRealtimeChannel({
        channelName: "game:1234",
        changes: [
          { event: "*", table: "rooms", filter: "pin=eq.1234" },
          { event: "INSERT", table: "votes", filter: "round_id=eq.r1" },
        ],
        onChange,
        enabled: overrides.enabled ?? true,
      }),
    );

    return { hook, channels, removeChannel, onChange };
  }

  it("subscribes with the configured postgres_changes filters", () => {
    const { channels, onChange } = setup();

    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("game:1234");
    expect(channels[0].handlers.map((h) => h.config)).toEqual([
      { event: "*", schema: "public", table: "rooms", filter: "pin=eq.1234" },
      {
        event: "INSERT",
        schema: "public",
        table: "votes",
        filter: "round_id=eq.r1",
      },
    ]);

    channels[0].handlers[0].handler();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe when disabled", () => {
    const { channels } = setup({ enabled: false });
    expect(channels).toHaveLength(0);
  });

  it("marks disconnected and resubscribes with backoff on channel error", () => {
    const { hook, channels, removeChannel, onChange } = setup();

    act(() => {
      channels[0].statusCallback?.("SUBSCRIBED");
    });
    expect(hook.result.current.disconnected).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      channels[0].statusCallback?.("CHANNEL_ERROR");
    });
    expect(hook.result.current.disconnected).toBe(true);
    expect(channels).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(channels).toHaveLength(2);

    act(() => {
      channels[1].statusCallback?.("SUBSCRIBED");
    });
    expect(hook.result.current.disconnected).toBe(false);
    // Refetches once on recovery to catch events missed while offline.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("polls onChange while disconnected and stops after recovery", () => {
    const { channels, onChange } = setup();

    act(() => {
      channels[0].statusCallback?.("CHANNEL_ERROR");
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Two 5s polls fired while the channel was down.
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2);

    const latestChannel = channels[channels.length - 1];
    act(() => {
      latestChannel.statusCallback?.("SUBSCRIBED");
    });
    const callsAfterRecovery = onChange.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onChange.mock.calls.length).toBe(callsAfterRecovery);
  });

  it("refetches and resubscribes when the tab becomes visible after a drop", () => {
    const { channels, onChange } = setup();

    act(() => {
      channels[0].statusCallback?.("CHANNEL_ERROR");
    });
    const channelCount = channels.length;
    onChange.mockClear();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onChange).toHaveBeenCalled();
    expect(channels.length).toBe(channelCount + 1);
  });

  it("removes the channel on unmount", () => {
    const { hook, channels, removeChannel } = setup();

    hook.unmount();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
  });
});
