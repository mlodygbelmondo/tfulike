import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/votes — Cast a vote
// Owner CAN vote on their own video now
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { round_id, guessed_player_id } = body;

    if (!round_id || !guessed_player_id) {
      return NextResponse.json(
        { error: "round_id and guessed_player_id are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify round is in voting status
    const { data: round } = await supabase
      .from("rounds")
      .select("status, correct_player_id, room_id")
      .eq("id", round_id)
      .single();

    if (!round || round.status !== "voting") {
      return NextResponse.json(
        { error: "Voting is closed for this round" },
        { status: 400 }
      );
    }

    const { data: callerPlayer } = await supabase
      .from("players")
      .select("id")
      .eq("room_id", round.room_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerPlayer) {
      return NextResponse.json(
        { error: "You are not a player in this room" },
        { status: 403 }
      );
    }

    // Insert vote (unique constraint handles duplicates)
    const { data: vote, error } = await adminSupabase
      .from("votes")
      .insert({ round_id, player_id: callerPlayer.id, guessed_player_id })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Already voted this round" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Failed to cast vote" },
        { status: 500 }
      );
    }

    // Check if all players have voted — if so, auto-trigger reveal
    const { data: allPlayers } = await adminSupabase
      .from("players")
      .select("id")
      .eq("room_id", round.room_id);

    const { count: voteCount } = await adminSupabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round_id);

    const playerCount = allPlayers?.length || 0;

    return NextResponse.json({
      vote,
      all_voted: voteCount !== null && voteCount >= playerCount,
      vote_count: voteCount || 0,
      player_count: playerCount,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
