import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/rooms/[pin]/rounds/next — Start next round (no timer/deadline)
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

    // Verify caller is the host
    if (player_id && room.host_player_id && player_id !== room.host_player_id) {
      return NextResponse.json(
        { error: "Only the host can advance rounds" },
        { status: 403 }
      );
    }

    const settings = room.settings as Record<string, unknown>;
    const totalRounds = (settings.total_rounds as number) || 30;
    const nextRoundNum = room.current_round + 1;

    if (nextRoundNum > totalRounds) {
      // Game over
      await supabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);
      return NextResponse.json({ finished: true });
    }

    const { data: existingNextRound } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_id", room.id)
      .eq("round_number", nextRoundNum)
      .maybeSingle();

    if (existingNextRound) {
      await supabase
        .from("rooms")
        .update({ current_round: nextRoundNum })
        .eq("id", room.id);

      return NextResponse.json({ round: existingNextRound, finished: false });
    }

    const { data: nextVideo } = await supabase
      .from("videos")
      .select("id, player_id, tiktok_url, video_url, video_urls, planned_round_number")
      .eq("room_id", room.id)
      .eq("planned_round_number", nextRoundNum)
      .maybeSingle();

    if (!nextVideo) {
      // No more videos — end game
      await supabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);
      return NextResponse.json({ finished: true });
    }

    // Mark used
    await supabase
      .from("videos")
      .update({ used: true })
      .eq("id", nextVideo.id);

    // Mark current round as done
    await supabase
      .from("rounds")
      .update({ status: "done", ended_at: new Date().toISOString() })
      .eq("room_id", room.id)
      .eq("round_number", room.current_round);

    // Create new round — no deadline
    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .insert({
        room_id: room.id,
        round_number: nextRoundNum,
        video_id: nextVideo.id,
        correct_player_id: nextVideo.player_id,
        status: "voting",
        deadline: null,
      })
      .select()
      .single();

    if (roundError || !round) {
      await supabase
        .from("videos")
        .update({ used: false })
        .eq("id", nextVideo.id);
      return NextResponse.json(
        { error: "Failed to create next round" },
        { status: 500 }
      );
    }

    // Update room
    await supabase
      .from("rooms")
      .update({ current_round: nextRoundNum })
      .eq("id", room.id);

    return NextResponse.json({ round, finished: false });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
