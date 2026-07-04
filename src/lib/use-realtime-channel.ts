"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface RealtimeChangeConfig {
  event: "*" | "INSERT" | "UPDATE" | "DELETE";
  table: string;
  filter?: string;
}

const RESUBSCRIBE_DELAYS_MS = [1000, 2000, 5000];
const DISCONNECTED_POLL_INTERVAL_MS = 5000;

/**
 * Supabase Realtime subscription that survives dropped connections.
 *
 * On CHANNEL_ERROR / TIMED_OUT / CLOSED it rebuilds the channel with
 * backoff, polls `onChange` while disconnected so the game keeps moving,
 * and refetches once on recovery and whenever the tab wakes up, since
 * events emitted during the gap are lost.
 */
export function useRealtimeChannel({
  channelName,
  changes,
  onChange,
  enabled = true,
}: {
  channelName: string;
  changes: RealtimeChangeConfig[];
  onChange: () => void;
  enabled?: boolean;
}) {
  const [disconnected, setDisconnected] = useState(false);
  const onChangeRef = useRef(onChange);
  const changesKey = JSON.stringify(changes);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

    const parsedChanges = JSON.parse(changesKey) as RealtimeChangeConfig[];
    const supabase = createClient();
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryAttempt = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let dropped = false;

    const teardownChannel = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleResubscribe = () => {
      if (disposed || retryTimeout) return;
      const delay =
        RESUBSCRIBE_DELAYS_MS[
          Math.min(retryAttempt, RESUBSCRIBE_DELAYS_MS.length - 1)
        ];
      retryAttempt += 1;
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        if (disposed) return;
        teardownChannel();
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (disposed) return;
      let building = supabase.channel(channelName);
      for (const change of parsedChanges) {
        building = building.on(
          "postgres_changes",
          {
            event: change.event,
            schema: "public",
            table: change.table,
            ...(change.filter ? { filter: change.filter } : {}),
          },
          () => onChangeRef.current(),
        );
      }
      channel = building;
      building.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          retryAttempt = 0;
          setDisconnected(false);
          if (dropped) {
            dropped = false;
            onChangeRef.current();
          }
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          dropped = true;
          setDisconnected(true);
          scheduleResubscribe();
        }
      });
    };

    const resubscribeNow = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      teardownChannel();
      subscribe();
    };

    const handleWake = () => {
      if (disposed || document.visibilityState !== "visible") return;
      onChangeRef.current();
      if (dropped) resubscribeNow();
    };

    const handleOnline = () => {
      if (disposed) return;
      onChangeRef.current();
      if (dropped) resubscribeNow();
    };

    const pollInterval = setInterval(() => {
      if (dropped) onChangeRef.current();
    }, DISCONNECTED_POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleWake);
    window.addEventListener("online", handleOnline);
    subscribe();

    return () => {
      disposed = true;
      clearInterval(pollInterval);
      if (retryTimeout) clearTimeout(retryTimeout);
      document.removeEventListener("visibilitychange", handleWake);
      window.removeEventListener("online", handleOnline);
      teardownChannel();
    };
  }, [enabled, channelName, changesKey]);

  return { disconnected: enabled && disconnected };
}
