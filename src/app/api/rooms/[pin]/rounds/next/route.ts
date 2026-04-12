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

    // Pick next unused video randomly
    const { data: unusedVideos } = await supabase
      .from("videos")
      .select("id, player_id, tiktok_url, video_url, video_urls")
      .eq("room_id", room.id)
      .eq("used", false);

    if (!unusedVideos || unusedVideos.length === 0) {
      // No more videos — end game
      await supabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);
      return NextResponse.json({ finished: true });
    }

    const video =
      unusedVideos[Math.floor(Math.random() * unusedVideos.length)];

    // Mark used
    await supabase
      .from("videos")
      .update({ used: true })
      .eq("id", video.id);

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
        video_id: video.id,
        correct_player_id: video.player_id,
        status: "voting",
        deadline: null,
      })
      .select()
      .single();

    if (roundError || !round) {
      await supabase
        .from("videos")
        .update({ used: false })
        .eq("id", video.id);
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
