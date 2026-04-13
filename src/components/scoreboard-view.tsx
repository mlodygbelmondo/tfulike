"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/player-avatar";
import { getStoredSession } from "@/lib/game";
import type { Player } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";

export function ScoreboardView({
  lang,
  pin,
  dict,
}: {
  lang: string;
  pin: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Use auth to verify the user belongs in this room, fall back to stored session
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const session = getStoredSession();

      if (!user && (!session || session.roomPin !== pin)) {
        router.push(`/${lang}/join`);
        return;
      }

      const { data: room } = await supabase
        .from("rooms")
        .select("id")
        .eq("pin", pin)
        .single();

      if (!room) return;

      const { data: playersData } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .order("score", { ascending: false });

      setPlayers((playersData as Player[]) || []);
      setLoading(false);
    }
    load();
  }, [pin, lang, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center min-h-screen p-6 gap-6">
        <div className="h-9 w-40 bg-surface rounded animate-pulse" />
        <div className="w-full max-w-sm flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-2xl bg-surface animate-pulse">
              <div className="w-8 h-8 bg-surface-2 rounded" />
              <div className="w-10 h-10 bg-surface-2 rounded-full" />
              <div className="flex-1 h-5 bg-surface-2 rounded" />
              <div className="h-6 w-16 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main className="flex flex-col items-center min-h-screen p-6 gap-6 animate-fade-in">
      <h1 className="text-3xl font-bold">{dict.scores.title}</h1>

      <div className="w-full max-w-sm flex flex-col gap-3">
        {players.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 p-4 rounded-2xl ${
              i === 0 ? "bg-accent/20 border border-accent/40" : "bg-surface"
            }`}
          >
            <span className="text-2xl font-bold text-muted w-8 text-center">
              {i + 1}
            </span>
            <PlayerAvatar
              nickname={p.nickname}
              color={p.color}
              size="md"
              showName={false}
            />
            <span className="flex-1 font-medium">{p.nickname}</span>
            <span className="text-xl font-bold text-accent">
              {p.score} {dict.game.points}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => router.push(`/${lang}/room/${pin}/play`)}
        className="h-14 w-full max-w-sm rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95"
      >
        {dict.scores.continue}
      </button>
    </main>
  );
}
