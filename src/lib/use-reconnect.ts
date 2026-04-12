"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredSession, clearSession } from "@/lib/game";

/**
 * Non-blocking hook that checks localStorage for a saved session.
 *
 * Returns:
 *  - `session`: the stored session object (or null)
 *  - `checking`: true while the initial localStorage read is pending (always
 *    synchronous, but we keep one tick to avoid hydration mismatches)
 *  - `dismiss`: call this to forget the session (clears localStorage)
 */
export function useStoredSession() {
  const [session, setSession] = useState<{
    playerId: string;
    sessionToken: string;
    roomPin: string;
  } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setSession(getStoredSession());
    setChecking(false);
  }, []);

  function dismiss() {
    clearSession();
    setSession(null);
  }

  return { session, checking, dismiss };
}

/**
 * Blocking reconnect hook — used on sub-pages (e.g. room/play) where we
 * actually *want* to redirect and block rendering until resolved.
 */
export function useReconnect(lang: string) {
  const router = useRouter();
  const [reconnecting, setReconnecting] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const session = getStoredSession();

    if (!session) {
      setReconnecting(false);
      return;
    }

    async function attemptReconnect() {
      try {
        const res = await fetch("/api/rooms/reconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            player_id: session!.playerId,
            session_token: session!.sessionToken,
            room_pin: session!.roomPin,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          // Redirect to the correct page
          router.push(`/${lang}${data.redirect}`);
          return;
        }

        // Session is invalid — clear it
        clearSession();
      } catch {
        // Network error — don't clear session, just stop reconnecting
        setFailed(true);
      }

      setReconnecting(false);
    }

    attemptReconnect();
  }, [lang, router]);

  return { reconnecting, failed };
}
