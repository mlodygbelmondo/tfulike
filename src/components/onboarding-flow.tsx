"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColorPicker } from "@/components/color-picker";
import { PLAYER_COLORS } from "@/lib/types";
import type { SyncStatus } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";
import {
  checkExtensionPresent,
  requestExtensionSync,
} from "@/lib/extension";

interface InitialProfile {
  nickname: string;
  color: string;
  avatar_url: string | null;
  tiktok_username: string | null;
  sync_status: SyncStatus;
}

interface OnboardingFlowProps {
  lang: string;
  dict: Dictionary;
  initialProfile: InitialProfile | null;
}

const TOTAL_STEPS = 3;

export function OnboardingFlow({ lang, dict, initialProfile }: OnboardingFlowProps) {
  const router = useRouter();
  const d = dict.onboarding;

  const [step, setStep] = useState(1);
  const [nickname, setNickname] = useState(initialProfile?.nickname ?? "");
  const [color, setColor] = useState(initialProfile?.color ?? PLAYER_COLORS[0]);
  const [avatarUrl] = useState(initialProfile?.avatar_url ?? null);

  // Step 2 — sync
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    initialProfile?.sync_status ?? "idle"
  );
  const [syncError, setSyncError] = useState("");
  const [extensionPresent, setExtensionPresent] = useState<boolean | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // -------------------------------------------------------------------------
  // Step 1 → save profile
  // -------------------------------------------------------------------------
  async function handleStep1Next() {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError(d.nicknamePlaceholder);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: trimmed, color }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save profile");
      }

      setStep(2);

      // Check extension in background
      checkExtensionPresent().then((version) => {
        setExtensionPresent(!!version);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 — sync likes via extension
  // -------------------------------------------------------------------------
  async function handleSync() {
    setSyncStatus("syncing");
    setSyncError("");

    try {
      const result = await requestExtensionSync({});

      if (result.ok) {
        if (!result.tiktok_username) {
          throw new Error("TikTok username was not returned by the extension");
        }

        const syncResponse = await fetch("/api/profile/sync-likes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tiktok_username: result.tiktok_username,
            likes: result.likes ?? [],
          }),
        });

        if (!syncResponse.ok) {
          const data = await syncResponse.json().catch(() => ({}));
          const detail = typeof data.detail === "string" && data.detail ? `: ${data.detail}` : "";
          throw new Error(
            `${typeof data.error === "string" && data.error ? data.error : d.syncError}${detail}`
          );
        }

        setSyncStatus("synced");

        // Persist the resolved TikTok username and profile sync status.
        await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sync_status: "synced",
            ...(result.tiktok_username
              ? { tiktok_username: result.tiktok_username }
              : {}),
          }),
        });
      } else {
        setSyncStatus("error");
        setSyncError(result.error || d.syncError);
      }
    } catch (err: unknown) {
      setSyncStatus("error");
      setSyncError(err instanceof Error ? err.message : d.syncError);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3 — complete onboarding
  // -------------------------------------------------------------------------
  async function handleFinish() {
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/profile/complete-onboarding", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to complete onboarding");
      }

      router.push(`/${lang}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="w-full max-w-md">
      {/* Progress bar */}
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i < step ? "bg-accent" : "bg-surface-2"
            }`}
          />
        ))}
        <span className="ml-2 text-xs text-muted">
          {step} {d.stepOf} {TOTAL_STEPS}
        </span>
      </div>

      {/* Step 1: Profile */}
      {step === 1 && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="text-center">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="mx-auto mb-4 h-20 w-20 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            )}
            <h2 className="text-2xl font-black tracking-tight text-accent">
              {d.step1Title}
            </h2>
            <p className="mt-2 text-sm text-muted">{d.step1Subtitle}</p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="onb-nickname" className="text-sm font-medium text-muted">
              {d.nickname}
            </label>
            <input
              id="onb-nickname"
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setError("");
              }}
              placeholder={d.nicknamePlaceholder}
              maxLength={20}
              className="h-14 rounded-2xl border border-surface-2 bg-surface px-4 text-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted">
              {d.pickColor}
            </label>
            <ColorPicker selected={color} onSelect={setColor} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleStep1Next}
            disabled={!nickname.trim() || saving}
            className="h-14 rounded-2xl bg-accent text-lg font-bold text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "..." : d.next}
          </button>
        </div>
      )}

      {/* Step 2: Sync TikTok Likes */}
      {step === 2 && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="text-center">
            <h2 className="text-2xl font-black tracking-tight text-accent">
              {d.step2Title}
            </h2>
            <p className="mt-2 text-sm text-muted">{d.step2Subtitle}</p>
          </div>

          {/* Sync status */}
          <div className="flex flex-col items-center gap-4">
            {syncStatus === "idle" && (
              <>
                {extensionPresent === false && (
                  <p className="text-center text-sm text-muted">{d.desktopSyncHint}</p>
                )}
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={extensionPresent === false}
                  className="h-14 w-full rounded-2xl bg-accent text-lg font-bold text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {d.syncLikes}
                </button>
              </>
            )}

            {syncStatus === "syncing" && (
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
                <p className="text-sm text-muted">{d.syncing}</p>
              </div>
            )}

            {syncStatus === "synced" && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-2xl">
                  ✓
                </div>
                <p className="text-sm font-medium text-green-400">{d.synced}</p>
              </div>
            )}

            {syncStatus === "error" && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-sm text-red-400">
                  {syncError || d.syncError}
                </p>
                <button
                  type="button"
                  onClick={handleSync}
                  className="h-12 rounded-2xl border border-surface-2 bg-surface px-6 text-sm font-bold text-foreground transition-transform active:scale-95"
                >
                  {d.syncRetry}
                </button>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="h-14 flex-1 rounded-2xl border border-surface-2 bg-surface text-lg font-bold text-foreground transition-transform active:scale-95"
            >
              {d.back}
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="h-14 flex-1 rounded-2xl bg-accent text-lg font-bold text-white transition-transform active:scale-95"
            >
              {syncStatus === "synced" ? d.next : d.skipSync}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-accent/20 text-4xl">
              🎉
            </div>
            <h2 className="text-2xl font-black tracking-tight text-accent">
              {d.step3Title}
            </h2>
            <p className="mt-2 text-sm text-muted">{d.step3Subtitle}</p>
          </div>

          {/* Profile preview */}
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-surface-2 bg-surface p-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {nickname.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-bold text-foreground">{nickname}</p>
              <p className="text-sm text-muted">
                {syncStatus === "synced" ? d.synced : d.skipSync}
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-14 flex-1 rounded-2xl border border-surface-2 bg-surface text-lg font-bold text-foreground transition-transform active:scale-95"
            >
              {d.back}
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="h-14 flex-1 rounded-2xl bg-accent text-lg font-bold text-white transition-transform active:scale-95 disabled:opacity-50"
            >
              {saving ? "..." : d.finish}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
