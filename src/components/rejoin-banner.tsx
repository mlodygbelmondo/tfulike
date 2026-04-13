"use client";

import { useRouter } from "next/navigation";
import { useStoredSession } from "@/lib/use-reconnect";
import type { Dictionary } from "@/lib/dictionaries";

/**
 * Non-blocking banner shown on the home page when a previous session exists.
 * Lets the user choose to rejoin or dismiss — never blocks page rendering.
 */
export function RejoinBanner({
  lang,
  dict,
}: {
  lang: string;
  dict: Dictionary;
}) {
  const { session, checking, dismiss } = useStoredSession();
  const router = useRouter();

  if (checking || !session) return null;

  async function handleRejoin() {
    try {
      // Reconnect API now uses auth cookies — just send room_pin
      const res = await fetch("/api/rooms/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_pin: session!.roomPin,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/${lang}${data.redirect}`);
        return;
      }

      // Session expired / invalid — clear it and hide the banner
      dismiss();
    } catch {
      // Network error — leave banner visible so user can retry
    }
  }

  return (
    <div className="w-full max-w-xs rounded-2xl bg-surface border border-surface-2 p-4 flex flex-col gap-3 animate-fade-in">
      <p className="text-sm text-muted text-center">
        {dict.home.rejoinPrompt.replace("{pin}", session.roomPin)}
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleRejoin}
          className="flex-1 h-10 rounded-xl bg-accent text-white font-semibold text-sm transition-transform active:scale-95"
        >
          {dict.home.rejoin}
        </button>
        <button
          onClick={dismiss}
          className="flex-1 h-10 rounded-xl bg-surface-2 text-muted font-semibold text-sm transition-transform active:scale-95"
        >
          {dict.home.dismiss}
        </button>
      </div>
    </div>
  );
}
