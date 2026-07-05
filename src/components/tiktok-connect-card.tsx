"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";

type ConnectState =
  | "idle"
  | "requesting"
  | "waiting"
  | "imported"
  | "error";

const POLL_INTERVAL_MS = 5000;
const MAX_AUTO_POLLS = 24; // ~2 minutes, then switch to manual "check again"

/**
 * TikTok Data Portability connect + sync card. Renders nothing unless
 * NEXT_PUBLIC_TIKTOK_PORTABILITY_ENABLED is "true" (requires an approved
 * TikTok developer app).
 */
export function TikTokConnectCard({
  dict,
  onSynced,
}: {
  dict: Dictionary;
  onSynced?: (likesImported: number) => void;
}) {
  const enabled =
    process.env.NEXT_PUBLIC_TIKTOK_PORTABILITY_ENABLED === "true";
  const d = dict.onboarding;
  const [state, setState] = useState<ConnectState>("idle");
  const [likesImported, setLikesImported] = useState<number | null>(null);
  const pollCountRef = useRef(0);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const pollStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/tiktok/portability/sync");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as {
        status?: string;
        likes_imported?: number;
      };

      if (data.status === "imported") {
        setState("imported");
        setLikesImported(data.likes_imported ?? null);
        onSynced?.(data.likes_imported ?? 0);
        return;
      }

      if (data.status === "expired" || data.status === "cancelled") {
        setState("error");
        return;
      }

      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_AUTO_POLLS) {
        setState("waiting");
        return;
      }

      pollTimeoutRef.current = setTimeout(() => {
        void pollStatus();
      }, POLL_INTERVAL_MS);
    } catch {
      setState("error");
    }
  }, [onSynced]);

  const startSync = useCallback(async () => {
    setState("requesting");
    pollCountRef.current = 0;

    try {
      const res = await fetch("/api/tiktok/portability/sync", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await pollStatus();
    } catch {
      setState("error");
    }
  }, [pollStatus]);

  // After the OAuth redirect lands back with ?tiktok=connected, kick off the
  // data request automatically.
  useEffect(() => {
    if (!enabled || startedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok") === "connected") {
      startedRef.current = true;
      void startSync();
    }
  }, [enabled, startSync]);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-surface-2 bg-surface p-4">
      {state === "idle" && (
        <>
          <p className="text-center text-sm text-muted">
            {d.tiktokConnectHint}
          </p>
          <button
            type="button"
            onClick={() => window.location.assign("/api/tiktok/oauth/start")}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-surface-2 bg-background text-sm font-bold text-foreground transition-transform active:scale-95"
          >
            {d.tiktokConnect}
          </button>
        </>
      )}

      {state === "requesting" && (
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <p className="text-sm text-muted">{d.tiktokSyncing}</p>
        </div>
      )}

      {state === "waiting" && (
        <>
          <p className="text-center text-sm text-muted">{d.tiktokWaiting}</p>
          <button
            type="button"
            onClick={() => {
              pollCountRef.current = 0;
              setState("requesting");
              void pollStatus();
            }}
            className="h-12 w-full rounded-2xl border border-surface-2 bg-background text-sm font-bold text-foreground transition-transform active:scale-95"
          >
            {d.tiktokCheckAgain}
          </button>
        </>
      )}

      {state === "imported" && (
        <p className="text-sm font-medium text-green-400">
          {d.tiktokSynced}
          {typeof likesImported === "number" ? ` (${likesImported})` : ""}
        </p>
      )}

      {state === "error" && (
        <>
          <p className="text-center text-sm text-red-400">{d.tiktokError}</p>
          <button
            type="button"
            onClick={() => void startSync()}
            className="h-12 w-full rounded-2xl border border-surface-2 bg-background text-sm font-bold text-foreground transition-transform active:scale-95"
          >
            {d.tiktokRetry}
          </button>
        </>
      )}
    </div>
  );
}
