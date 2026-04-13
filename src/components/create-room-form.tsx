"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/dictionaries";
import type { Profile } from "@/lib/types";
import { storeSession } from "@/lib/game";

export function CreateRoomForm({
  lang,
  dict,
  profile,
}: {
  lang: string;
  dict: Dictionary;
  profile: Profile;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create room");
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
    <div className="flex h-full w-full flex-1 flex-col gap-6">
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
      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="mt-auto h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? dict.create.creating : dict.create.create}
      </button>
    </div>
  );
}
