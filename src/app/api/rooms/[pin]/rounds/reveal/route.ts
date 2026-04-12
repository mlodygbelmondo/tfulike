import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateRoundScores } from "@/lib/game";

// POST /api/rooms/[pin]/rounds/reveal — Reveal answers and score
// No timer/deadline required — anyone can reveal when all have voted, or host can force it
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const body = await request.json().catch(() => ({}));
    const { player_id } = body as { player_id?: string };
    const supabase = await createClient();

    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .eq("status", "playing")
      .single();

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Get current round
    const { data: round } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .eq("status", "voting")
      .single();

    if (!round) {
      // Already revealed — return current state
      const { data: existingRound } = await supabase
        .from("rounds")
        .select("*")
        .eq("room_id", room.id)
        .eq("round_number", room.current_round)
        .single();

      if (existingRound && existingRound.status === "reveal") {
        const { data: players } = await supabase
          .from("players")
          .select("*")
          .eq("room_id", room.id)
          .order("score", { ascending: false });

        const { data: votes } = await supabase
          .from("votes")
          .select("*")
          .eq("round_id", existingRound.id);

        return NextResponse.json({
          round: existingRound,
          correct_player_id: existingRound.correct_player_id,
          votes: votes || [],
          score_deltas: {},
          players,
          already_revealed: true,
        });
      }

      return NextResponse.json(
        { error: "No active voting round" },
        { status: 400 }
      );
    }

    // Authorization: host can always reveal; any player can reveal when all have voted
    const isHost =
      player_id && room.host_player_id && player_id === room.host_player_id;

    if (!isHost) {
      // Check if all players have voted
      const { data: allPlayers } = await supabase
        .from("players")
        .select("id")
        .eq("room_id", room.id);

      const { count: voteCount } = await supabase
        .from("votes")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);

      const playerCount = allPlayers?.length || 0;
      const allVoted = voteCount !== null && voteCount >= playerCount;

      if (!allVoted) {
        return NextResponse.json(
          { error: "Not all players have voted yet" },
          { status: 403 }
        );
      }
    }

    // Get all votes for this round
    const { data: votes } = await supabase
      .from("votes")
      .select("*")
      .eq("round_id", round.id);

    // Calculate scores
    const scoreDeltas = calculateRoundScores(
      votes || [],
      round.correct_player_id!
    );

    // Batch: mark votes as correct/incorrect
    await Promise.all(
      (votes || []).map((vote) => {
        const isCorrect = vote.guessed_player_id === round.correct_player_id;
        return supabase
          .from("votes")
          .update({ is_correct: isCorrect })
          .eq("id", vote.id);
      })
    );

    // Batch: update player scores
    const playerIds = Array.from(scoreDeltas.keys());
    if (playerIds.length > 0) {
      const { data: currentPlayers } = await supabase
        .from("players")
        .select("id, score")
        .in("id", playerIds);

      await Promise.all(
        (currentPlayers || []).map((p) => {
          const delta = scoreDeltas.get(p.id) || 0;
          return supabase
            .from("players")
            .update({ score: p.score + delta })
            .eq("id", p.id);
        })
      );
    }

    // Update round status to reveal
    const { data: revealedRounds } = await supabase
      .from("rounds")
      .update({ status: "reveal" })
      .eq("id", round.id)
      .eq("status", "voting")
      .select("id");

    if (!revealedRounds || revealedRounds.length === 0) {
      const { data: players } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .order("score", { ascending: false });

      return NextResponse.json({
        round: { ...round, status: "reveal" },
        correct_player_id: round.correct_player_id,
        votes: votes || [],
        score_deltas: {},
        players,
        already_revealed: true,
      });
    }

    // Get updated players
    const { data: players } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .order("score", { ascending: false });

    return NextResponse.json({
      round: { ...round, status: "reveal" },
      correct_player_id: round.correct_player_id,
      votes: votes || [],
      score_deltas: Object.fromEntries(scoreDeltas),
      players,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
