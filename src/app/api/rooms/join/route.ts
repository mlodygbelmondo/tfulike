import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLAYER_COLORS } from "@/lib/types";

// POST /api/rooms/join — Join an existing room
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pin, nickname, color, tiktok_username } = body;

    if (!pin || !nickname?.trim() || !color || !tiktok_username?.trim()) {
      return NextResponse.json(
        { error: "PIN, nickname, color, and TikTok username are required" },
        { status: 400 }
      );
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "PIN must be exactly 4 digits" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Find room by PIN
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .eq("status", "lobby")
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { error: "Room not found or game already started" },
        { status: 404 }
      );
    }

    // Check player count
    const { count } = await supabase
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id);

    if ((count || 0) >= 8) {
      return NextResponse.json({ error: "Room is full (max 8)" }, { status: 400 });
    }

    // Check for duplicate nickname in room
    const { data: existingPlayer } = await supabase
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("nickname", nickname.trim())
      .single();

    if (existingPlayer) {
      return NextResponse.json(
        { error: "Nickname already taken in this room" },
        { status: 400 }
      );
    }

    // Check color availability and resolve conflicts
    const { data: existingColors } = await supabase
      .from("players")
      .select("color")
      .eq("room_id", room.id);

    const takenColors = existingColors?.map((p) => p.color) || [];
    let finalColor = color;
    if (takenColors.includes(color)) {
      const available = PLAYER_COLORS.find((c) => !takenColors.includes(c));
      if (!available) {
        return NextResponse.json(
          { error: "No colors available" },
          { status: 400 }
        );
      }
      finalColor = available;
    }

    // Create player
    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: room.id,
        nickname: nickname.trim(),
        color: finalColor,
        tiktok_username: tiktok_username.trim(),
        is_host: false,
      })
      .select()
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { error: "Failed to join room" },
        { status: 500 }
      );
    }

    return NextResponse.json({ room, player });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
