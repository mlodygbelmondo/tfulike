"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/player-avatar";
import { clearSession } from "@/lib/game";
import type { Player } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";

const TROPHY = ["1st", "2nd", "3rd"];
const TROPHY_COLORS = ["text-yellow-400", "text-gray-300", "text-amber-600"];

export function ResultsView({
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
  }, [pin]);

  function handleNewGame() {
    clearSession();
    router.push(`/${lang}`);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center min-h-screen p-6 gap-8">
        <div className="h-10 w-48 bg-surface rounded animate-pulse mt-8" />
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 bg-surface rounded-full animate-pulse" />
          <div className="h-5 w-24 bg-surface rounded animate-pulse" />
          <div className="h-7 w-20 bg-surface rounded animate-pulse" />
        </div>
        <div className="w-full max-w-sm flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-surface animate-pulse">
              <div className="w-10 h-5 bg-surface-2 rounded" />
              <div className="w-8 h-8 bg-surface-2 rounded-full" />
              <div className="flex-1 h-5 bg-surface-2 rounded" />
              <div className="h-5 w-10 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const winner = players[0];

  return (
    <main className="flex flex-col items-center min-h-screen p-6 gap-8 animate-fade-in">
      {/* Title */}
      <h1 className="text-4xl font-black text-accent mt-8">
        {dict.results.title}
      </h1>

      {/* Winner spotlight */}
      {winner && (
        <div className="flex flex-col items-center gap-3 animate-bounce-in">
          <span className="text-5xl">👑</span>
          <PlayerAvatar
            nickname={winner.nickname}
            color={winner.color}
            size="lg"
          />
          <span className="text-2xl font-bold">
            {winner.score} {dict.game.points}
          </span>
        </div>
      )}

      {/* Rankings */}
      <div className="w-full max-w-sm flex flex-col gap-2">
        {players.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 p-3 rounded-xl animate-slide-up ${
              i < 3 ? "bg-surface border border-surface-2" : "bg-surface/50"
            }`}
            style={{ animationDelay: `${(i + 1) * 100}ms` }}
          >
            <span
              className={`text-lg font-bold w-10 text-center ${
                i < 3 ? TROPHY_COLORS[i] : "text-muted"
              }`}
            >
              {i < 3 ? TROPHY[i] : `${i + 1}th`}
            </span>
            <PlayerAvatar
              nickname={p.nickname}
              color={p.color}
              size="sm"
              showName={false}
            />
            <span className="flex-1 font-medium">{p.nickname}</span>
            <span className="font-bold text-accent">
              {p.score}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-sm mt-auto">
        <button
          onClick={handleNewGame}
          className="h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95"
        >
          {dict.results.newGame}
        </button>
      </div>
    </main>
  );
}
