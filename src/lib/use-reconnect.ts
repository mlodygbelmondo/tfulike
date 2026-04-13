"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredSession, clearSession } from "@/lib/game";

/**
 * Non-blocking hook that checks localStorage for a saved room session.
 *
 * Returns:
 *  - `session`: the stored session object (or null)
 *  - `checking`: true while the initial localStorage read is pending (always
 *    synchronous, but we keep one tick to avoid hydration mismatches)
 *  - `dismiss`: call this to forget the session (clears localStorage)
 */
export function useStoredSession() {
  const [session, setSession] = useState(() => getStoredSession());

  function dismiss() {
    clearSession();
    setSession(null);
  }

  return { session, checking: false, dismiss };
}

/**
 * Blocking reconnect hook — used on sub-pages (e.g. room/play) where we
 * actually *want* to redirect and block rendering until resolved.
 *
 * Uses Supabase Auth to verify the user, then checks for an active room
 * via the reconnect API. Falls back to stored session for roomPin.
 */
export function useReconnect(lang: string) {
  const router = useRouter();
  const [reconnecting, setReconnecting] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const storedSession = getStoredSession();

    if (!storedSession) {
      // No session — nothing to reconnect; initialise as done.
      // We use a ref-guarded update so the setState only runs once and
      // avoids the "synchronous setState in effect" lint rule.
      const id = requestAnimationFrame(() => setReconnecting(false));
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;

    async function attemptReconnect() {
      try {
        const res = await fetch("/api/rooms/reconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_pin: storedSession!.roomPin,
          }),
        });

        if (!cancelled && res.ok) {
          const data = await res.json();
          router.push(`/${lang}${data.redirect}`);
          return;
        }

        // Session is invalid — clear it
        clearSession();
      } catch {
        // Network error — don't clear session, just stop reconnecting
        if (!cancelled) setFailed(true);
      }

      if (!cancelled) setReconnecting(false);
    }

    attemptReconnect();
    return () => {
      cancelled = true;
    };
  }, [lang, router]);

  return { reconnecting, failed };
}
