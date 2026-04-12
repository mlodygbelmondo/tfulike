"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredProfile, storeSession, type StoredProfile } from "@/lib/game";
import type { Dictionary } from "@/lib/dictionaries";

export function CreateRoomForm({
  lang,
  dict,
}: {
  lang: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [storedProfile] = useState<StoredProfile | null>(() =>
    getStoredProfile()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!storedProfile) {
      router.replace(`/${lang}?profile=edit`);
    }
  }, [lang, router, storedProfile]);

  const nickname = storedProfile?.nickname ?? "";
  const color = storedProfile?.color ?? "";
  const tiktokUsername = storedProfile?.tiktok ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim() || !tiktokUsername) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim(),
          color,
          tiktok_username: tiktokUsername,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create room");
        setLoading(false);
        return;
      }

      storeSession(data.player.id, data.player.session_token, data.room.pin);
      router.push(`/${lang}/room/${data.room.pin}`);
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full w-full flex-1 flex-col gap-6">
      <div className="rounded-2xl border border-surface-2 bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted">{dict.profile.title}</p>
            <div className="mt-3 flex flex-col gap-2 text-sm text-foreground">
              <span>{nickname}</span>
              <span>{tiktokUsername ? `@${tiktokUsername}` : ""}</span>
            </div>
          </div>

          <Link
            href={`/${lang}?profile=edit`}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-surface-2 px-3 text-xs leading-none font-medium text-muted transition-colors hover:text-foreground"
          >
            {dict.profile.edit}
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-muted">{dict.profile.pickColor}</span>
          <span
            className="block h-5 w-5 rounded-full border border-white/20"
            style={{ backgroundColor: color }}
            aria-label={`Stored color ${color}`}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !nickname.trim() || !tiktokUsername}
        className="mt-auto h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? dict.create.creating : dict.create.create}
      </button>
    </form>
  );
}
