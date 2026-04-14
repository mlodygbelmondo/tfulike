import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/rooms/[pin]/rounds/next — Start next round (no timer/deadline)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    await request.json().catch(() => ({}));
    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .eq("status", "playing")
      .single();

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: callerPlayer } = await supabase
      .from("players")
      .select("id, user_id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerPlayer) {
      return NextResponse.json(
        { error: "You are not a player in this room" },
        { status: 403 }
      );
    }

    // Verify caller is the host
    if (callerPlayer.id !== room.host_player_id) {
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
      await adminSupabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);
      return NextResponse.json({ finished: true });
    }

    const { data: existingNextRound } = await adminSupabase
      .from("rounds")
      .select("*")
      .eq("room_id", room.id)
      .eq("round_number", nextRoundNum)
      .maybeSingle();

    if (existingNextRound) {
      await adminSupabase
        .from("rooms")
        .update({ current_round: nextRoundNum })
        .eq("id", room.id);

      return NextResponse.json({ round: existingNextRound, finished: false });
    }

    const { data: nextVideo } = await adminSupabase
      .from("videos")
      .select("id, player_id, tiktok_url, video_url, video_urls, planned_round_number")
      .eq("room_id", room.id)
      .eq("used", false)
      .eq("planned_round_number", nextRoundNum)
      .maybeSingle();

    if (!nextVideo) {
      // No more videos — end game
      await adminSupabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);
      return NextResponse.json({ finished: true });
    }

    // Mark used
    await adminSupabase
      .from("videos")
      .update({ used: true })
      .eq("id", nextVideo.id);

    // Mark current round as done
    await adminSupabase
      .from("rounds")
      .update({ status: "done", ended_at: new Date().toISOString() })
      .eq("room_id", room.id)
      .eq("round_number", room.current_round);

    // Create new round — no deadline
    const { data: round, error: roundError } = await adminSupabase
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
      await adminSupabase
        .from("videos")
        .update({ used: false })
        .eq("id", nextVideo.id);
      return NextResponse.json(
        { error: "Failed to create next round" },
        { status: 500 }
      );
    }

    // Update room
    await adminSupabase
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
