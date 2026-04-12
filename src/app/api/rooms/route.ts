import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/rooms — Create a new room
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nickname, color, tiktok_username } = body;

    if (!nickname?.trim() || !color || !tiktok_username?.trim()) {
      return NextResponse.json(
        { error: "Nickname, color, and TikTok username are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Generate unique PIN
    const { data: pinData, error: pinError } = await supabase.rpc(
      "generate_room_pin"
    );
    if (pinError) {
      return NextResponse.json(
        { error: "Failed to generate PIN" },
        { status: 500 }
      );
    }

    const pin = pinData as string;

    // Create room
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({ pin, status: "lobby" })
      .select()
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { error: "Failed to create room" },
        { status: 500 }
      );
    }

    // Create host player
    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: room.id,
        nickname: nickname.trim(),
        color,
        tiktok_username: tiktok_username.trim(),
        is_host: true,
      })
      .select()
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { error: "Failed to create player" },
        { status: 500 }
      );
    }

    // Set host_player_id on room
    await supabase
      .from("rooms")
      .update({ host_player_id: player.id })
      .eq("id", room.id);

    return NextResponse.json({
      room: { ...room, host_player_id: player.id },
      player,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
