"use client";

import { useEffect, useState } from "react";
import { ColorPicker } from "@/components/color-picker";
import {
  getStoredProfile,
  getStoredSession,
  parseTikTokUsername,
  storeProfile,
  type StoredProfile,
} from "@/lib/game";
import { PLAYER_COLORS } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";

interface ProfileSetupProps {
  dict: Dictionary;
  forceOpen?: boolean;
}

export function ProfileSetup({ dict, forceOpen = false }: ProfileSetupProps) {
  const [profile, setProfile] = useState<StoredProfile>({
    nickname: "",
    color: PLAYER_COLORS[0],
    tiktok: "",
  });
  const [open, setOpen] = useState(forceOpen);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = getStoredProfile();
    if (stored) {
      setProfile(stored);
      setOpen(forceOpen);
      return;
    }

    setOpen(true);
  }, [forceOpen]);

  if (!open) return null;

  const hasExistingProfile = !!getStoredProfile();

  function updateProfile(patch: Partial<StoredProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
  }

  async function handleSave() {
    const nickname = profile.nickname.trim();
    const tiktok = parseTikTokUsername(profile.tiktok);

    if (!nickname) {
      setError(dict.profile.nicknamePlaceholder);
      return;
    }

    if (!tiktok) {
      setError(dict.profile.invalidTiktok);
      return;
    }

    storeProfile({
      nickname,
      color: profile.color,
      tiktok,
    });

    const session = getStoredSession();
    if (session) {
      try {
        await fetch("/api/players/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            player_id: session.playerId,
            session_token: session.sessionToken,
            room_pin: session.roomPin,
            nickname,
            color: profile.color,
            tiktok_username: tiktok,
          }),
        });
      } catch {
        // Keep local profile saved even if room sync fails.
      }
    }

    setProfile({ nickname, color: profile.color, tiktok });
    setError("");
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-surface-2 bg-background p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-accent">
              {dict.profile.title}
            </h2>
            <p className="mt-2 text-sm text-muted">{dict.profile.subtitle}</p>
          </div>
          {hasExistingProfile && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-surface-2 px-3 py-1 text-sm text-muted transition-colors hover:text-foreground"
            >
              {dict.profile.close}
            </button>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="profile-nickname" className="text-sm font-medium text-muted">
              {dict.profile.nickname}
            </label>
            <input
              id="profile-nickname"
              type="text"
              value={profile.nickname}
              onChange={(event) => {
                updateProfile({ nickname: event.target.value });
                setError("");
              }}
              placeholder={dict.profile.nicknamePlaceholder}
              maxLength={20}
              className="h-14 rounded-2xl border border-surface-2 bg-surface px-4 text-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted">
              {dict.profile.pickColor}
            </label>
            <ColorPicker
              selected={profile.color}
              onSelect={(color) => updateProfile({ color })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="profile-tiktok" className="text-sm font-medium text-muted">
              {dict.profile.tiktok}
            </label>
            <input
              id="profile-tiktok"
              type="text"
              value={profile.tiktok}
              onChange={(event) => {
                updateProfile({ tiktok: event.target.value });
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSave();
                }
              }}
              placeholder={dict.profile.tiktokPlaceholder}
              className="h-14 rounded-2xl border border-surface-2 bg-surface px-4 text-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleSave}
            disabled={!profile.nickname.trim() || !profile.tiktok.trim()}
            className="h-14 rounded-2xl bg-accent text-lg font-bold text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dict.profile.save}
          </button>
        </div>
      </div>
    </div>
  );
}
