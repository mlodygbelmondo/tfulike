"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/dictionaries";
import type { Profile } from "@/lib/types";
import { storeSession } from "@/lib/game";

export function JoinRoomForm({
  lang,
  dict,
  profile,
  initialPin,
}: {
  lang: string;
  dict: Dictionary;
  profile: Profile;
  initialPin?: string;
}) {
  const router = useRouter();
  const [pin, setPin] = useState(initialPin || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim() || pin.length < 4) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to join room");
        setLoading(false);
        return;
      }

      // Store room session for reconnection
      storeSession(data.player.id, data.room.pin);
      router.push(`/${lang}/room/${data.room.pin}`);
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full w-full flex-1 flex-col gap-6">
      {/* PIN */}
      <div className="flex flex-col gap-2">
        <label htmlFor="pin" className="text-sm font-medium text-muted">
          {dict.join.pin}
        </label>
        <input
          id="pin"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{4}"
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          placeholder={dict.join.pinPlaceholder}
          maxLength={4}
          required
          className="h-14 placeholder:-translate-y-1 px-4 rounded-2xl bg-surface border border-surface-2 text-foreground text-center text-3xl font-mono tracking-[0.5em] placeholder:text-muted/50 placeholder:text-lg placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Profile preview */}
      <div className="rounded-2xl border border-surface-2 bg-surface p-4">
        <p className="text-sm font-medium text-muted">{dict.profile.title}</p>
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: profile.color }}
          >
            {profile.nickname.charAt(0).toUpperCase()}
          </div>
          <div>
            <span className="font-medium text-foreground">{profile.nickname}</span>
            {profile.tiktok_username && (
              <span className="ml-2 text-sm text-muted">@{profile.tiktok_username}</span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !pin.trim() || pin.length < 4}
        className="mt-auto h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? dict.join.joining : dict.join.join}
      </button>
    </form>
  );
}
