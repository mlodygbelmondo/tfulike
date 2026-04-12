"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredProfile, storeSession } from "@/lib/game";
import type { Dictionary } from "@/lib/dictionaries";

export function JoinRoomForm({
  lang,
  dict,
  initialPin,
}: {
  lang: string;
  dict: Dictionary;
  initialPin?: string;
}) {
  const router = useRouter();
  const [pin, setPin] = useState(initialPin || "");
  const [nickname, setNickname] = useState("");
  const [color, setColor] = useState("");
  const [tiktokUsername, setTiktokUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedProfile = getStoredProfile();

    if (!storedProfile) {
      router.replace(`/${lang}?profile=edit`);
      return;
    }

    setNickname(storedProfile.nickname);
    setColor(storedProfile.color);
    setTiktokUsername(storedProfile.tiktok);
  }, [lang, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim() || !nickname.trim() || !tiktokUsername) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: pin.trim(),
          nickname: nickname.trim(),
          color,
          tiktok_username: tiktokUsername,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to join room");
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full">
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

      <div className="rounded-2xl border border-surface-2 bg-surface p-4 pt-2">
        <div className="flex w-full items-start justify-between gap-4">
          <div className="w-full">
            <div className="w-full justify-between flex items-center">
              <p className="text-sm font-medium text-muted">
                {dict.profile.title}
              </p>
              <Link
                href={`/${lang}?profile=edit`}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-surface-2 px-3 text-xs leading-none font-medium text-muted transition-colors hover:text-foreground"
              >
                {dict.profile.edit}
              </Link>
            </div>

            <div className="-mt-1 flex flex-col gap-2 text-sm text-foreground">
              <span>{nickname}</span>
              <span>{tiktokUsername ? `@${tiktokUsername}` : ""}</span>
            </div>
          </div>
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
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {/* Submit */}
      <button
        type="submit"
        disabled={
          loading ||
          !pin.trim() ||
          pin.length < 4 ||
          !nickname.trim() ||
          !tiktokUsername
        }
        className="h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? dict.join.joining : dict.join.join}
      </button>
    </form>
  );
}
