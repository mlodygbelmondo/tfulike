"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/player-avatar";
import { getStoredSession } from "@/lib/game";
import type { Player, Room, SyncStatus } from "@/lib/types";
import { ROUND_COUNT_OPTIONS } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";
import Link from "next/link";
import {
  checkExtensionPresent,
  requestExtensionSync,
} from "@/lib/extension";

export function LobbyView({
  lang,
  pin,
  dict,
}: {
  lang: string;
  pin: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Round count selector
  const [selectedRounds, setSelectedRounds] = useState<number | null>(null);

  // Extension detection
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [extensionChecked, setExtensionChecked] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);

  // Check extension on mount
  useEffect(() => {
    checkExtensionPresent().then((version) => {
      setExtensionVersion(version);
      setExtensionChecked(true);
    });
  }, []);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get the authenticated user to identify the current player
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Also check stored session for playerId as a fallback
    const session = getStoredSession();

    // Fetch room
    const { data: roomData } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .single();

    if (!roomData) {
      setError("Room not found");
      setLoading(false);
      return;
    }

    setRoom(roomData as Room);

    // If game started, redirect to play
    if (roomData.status === "playing") {
      router.push(`/${lang}/room/${pin}/play`);
      return;
    }
    if (roomData.status === "finished") {
      router.push(`/${lang}/room/${pin}/results`);
      return;
    }

    // Load round count from settings if already set
    const settings = roomData.settings as Record<string, unknown>;
    if (settings?.max_rounds && typeof settings.max_rounds === "number") {
      setSelectedRounds(settings.max_rounds);
    }

    // Fetch players
    const { data: playersData } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomData.id)
      .order("created_at");

    const roomPlayers = (playersData as Player[]) || [];

    setPlayers(roomPlayers);

    // Identify current player: prefer auth user_id match, fall back to stored playerId
    if (roomPlayers.length > 0) {
      let me: Player | undefined;
      if (user) {
        me = roomPlayers.find((p: Player) => p.user_id === user.id);
      }
      if (!me && session?.roomPin === pin && session.playerId) {
        me = roomPlayers.find((p: Player) => p.id === session.playerId);
      }
      if (me) {
        setCurrentPlayer(me as Player);
      }
    }

    setLoading(false);
  }, [pin, lang, router]);

  const roomId = room?.id ?? null;

  useEffect(() => {
    fetchData();

    // Subscribe to realtime changes
    const supabase = createClient();

    let channel = supabase.channel(`room:${pin}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `pin=eq.${pin}` },
      () => fetchData()
    );

    if (roomId) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => fetchData()
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData, pin, roomId]);

  async function handleRoundCountChange(count: number) {
    setSelectedRounds(count);
    if (!room) return;

    const res = await fetch(`/api/rooms/${pin}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_rounds: count }),
    });

    if (!res.ok) {
      setError("Failed to update round count");
      setSelectedRounds(
        typeof room.settings?.max_rounds === "number" ? room.settings.max_rounds : null
      );
      return;
    }

    const data = await res.json();
    if (data?.room) {
      setRoom(data.room as Room);
    }
  }

  async function handleSyncLikes() {
    if (!currentPlayer || !room || syncing) return;
    if (!extensionVersion) {
      setError(dict.lobby.extensionNotFound);
      return;
    }

    setSyncing(true);
    setError("");

    try {
      const result = await requestExtensionSync({});

      if (!result.ok) {
        setError(result.error || dict.lobby.syncError);
      } else if (result.tiktok_username) {
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
            `${typeof data.error === "string" && data.error ? data.error : dict.lobby.syncError}${detail}`
          );
        }

        await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tiktok_username: result.tiktok_username,
            sync_status: "synced",
          }),
        });
        await fetchData();
      } else {
        setError("TikTok username was not returned by the extension");
      }
      // The lobby reads sync state and username from profiles.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : dict.lobby.syncError);
    } finally {
      setSyncing(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    setError("");

    try {
      const res = await fetch(`/api/rooms/${pin}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentPlayer?.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        setStarting(false);
        return;
      }

      router.push(`/${lang}/room/${pin}/play`);
    } catch {
      setError("Failed to start game");
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center min-h-screen p-6 gap-6">
        {/* Skeleton: header */}
        <div className="text-center">
          <div className="h-8 w-40 bg-surface rounded animate-pulse mx-auto" />
          <div className="mt-3 h-12 w-32 bg-surface rounded animate-pulse mx-auto" />
        </div>
        {/* Skeleton: players list */}
        <div className="w-full max-w-sm">
          <div className="h-4 w-24 bg-surface rounded animate-pulse mb-3" />
          <div className="bg-surface rounded-2xl p-4 flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-surface-2 animate-pulse" />
                <div className="flex-1 h-5 bg-surface-2 rounded animate-pulse" />
                <div className="h-5 w-16 bg-surface-2 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        </div>
        {/* Skeleton: button */}
        <div className="mt-auto w-full max-w-sm">
          <div className="h-14 bg-surface rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <p className="text-red-400 mb-4">Room not found</p>
        <Link href={`/${lang}`} className="text-accent">
          Go home
        </Link>
      </div>
    );
  }

  const isHost = currentPlayer?.is_host;
  const allSynced = players.length >= 2 && players.every((p) => p.sync_status === "synced");
  const canStart = allSynced;
  const mySyncStatus: SyncStatus = currentPlayer?.sync_status || "idle";

  return (
    <main className="flex flex-col items-center min-h-screen p-6 gap-6 animate-fade-in">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold">{dict.lobby.title}</h1>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="text-muted text-sm">{dict.lobby.pin}:</span>
          <span className="text-4xl font-mono font-bold tracking-[0.3em] text-accent">
            {pin}
          </span>
        </div>
      </div>

      {/* Players */}
      <div className="w-full max-w-sm">
        <h2 className="text-sm font-medium text-muted mb-3">
          {dict.lobby.players} ({players.length}/8)
        </h2>
        <div className="bg-surface rounded-2xl p-4">
          {players.length === 0 ? (
            <p className="text-muted text-center py-4">
              {dict.lobby.waitingForPlayers}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {players.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <PlayerAvatar
                    nickname={p.nickname}
                    color={p.color}
                    size="sm"
                    showName={false}
                  />
                  <span className="flex-1 font-medium">
                    {p.nickname}
                    {p.is_host && (
                      <span className="ml-2 text-xs text-accent">HOST</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    {p.tiktok_username && (
                      <span className="text-xs text-muted">
                        @{p.tiktok_username}
                      </span>
                    )}
                    <SyncBadge status={p.sync_status} dict={dict} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sync button for current player */}
      {currentPlayer && extensionChecked && (
        <div className="w-full max-w-sm">
          {extensionVersion ? (
            <div className="space-y-2">
              <button
                onClick={handleSyncLikes}
                disabled={syncing || mySyncStatus === "syncing"}
                className={`w-full h-12 rounded-xl font-medium text-sm transition-all active:scale-95 ${
                  mySyncStatus === "synced"
                    ? "bg-green-900/30 text-green-400 border border-green-800"
                    : mySyncStatus === "syncing" || syncing
                    ? "bg-surface-2 text-muted cursor-wait"
                    : mySyncStatus === "error"
                    ? "bg-red-900/30 text-red-400 border border-red-800"
                    : "bg-accent/20 text-accent border border-accent/50 hover:bg-accent/30"
                }`}
              >
                {mySyncStatus === "syncing" || syncing
                  ? dict.lobby.syncing
                  : mySyncStatus === "synced"
                  ? dict.lobby.synced
                  : mySyncStatus === "error"
                  ? dict.lobby.syncRetry
                  : dict.lobby.syncLikes}
              </button>
              <p className="text-xs text-muted text-center">{dict.lobby.desktopSyncHint}</p>
            </div>
          ) : (
            <div className="text-center py-2 px-3 rounded-xl bg-yellow-900/20 border border-yellow-800 text-yellow-400 text-sm">
              {dict.lobby.extensionRequired}
            </div>
          )}
        </div>
      )}

      {/* Host Controls: Round Count */}
      {isHost && (
        <div className="w-full max-w-sm">
          <h2 className="text-sm font-medium text-muted mb-2">
            {dict.lobby.roundCount}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {ROUND_COUNT_OPTIONS.map((count) => (
              <button
                key={count}
                onClick={() => handleRoundCountChange(count)}
                className={`h-11 w-full rounded-xl px-3 py-2 text-center text-sm font-medium transition-all active:scale-95 ${
                  selectedRounds === count
                    ? "bg-accent text-white"
                    : "bg-surface border border-surface-2 text-muted hover:border-accent"
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-sm mt-auto">
        {players.length < 2 && (
          <p className="text-muted text-sm text-center">
            {dict.lobby.minPlayers}
          </p>
        )}

        {isHost && (
          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? dict.lobby.starting : dict.lobby.startGame}
          </button>
        )}

        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </main>
  );
}

function SyncBadge({ status, dict }: { status: SyncStatus; dict: Dictionary }) {
  switch (status) {
    case "synced":
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400">
          {dict.lobby.synced}
        </span>
      );
    case "syncing":
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-400 animate-pulse">
          {dict.lobby.syncing}
        </span>
      );
    case "error":
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-red-900/30 text-red-400">
          {dict.lobby.syncError}
        </span>
      );
    default:
      return (
        <span className="text-xs px-2 py-1 rounded-full bg-surface-2 text-muted">
          {dict.lobby.syncIdle}
        </span>
      );
  }
}
