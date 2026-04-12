import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/rooms/reconnect — Reconnect to a room using session token
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { player_id, session_token, room_pin } = body;

    if (!player_id || !session_token || !room_pin) {
      return NextResponse.json(
        { error: "player_id, session_token, and room_pin are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Find the player by ID and verify session token
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("id", player_id)
      .eq("session_token", session_token)
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 }
      );
    }

    // Find the room and verify it matches
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", room_pin)
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { error: "Room not found" },
        { status: 404 }
      );
    }

    // Verify the player belongs to this room
    if (player.room_id !== room.id) {
      return NextResponse.json(
        { error: "Player does not belong to this room" },
        { status: 403 }
      );
    }

    // Room is finished
    if (room.status === "finished") {
      return NextResponse.json({
        room,
        player,
        redirect: `/${room_pin}/results`,
      });
    }

    // Determine where the player should go
    let redirect: string;
    if (room.status === "lobby") {
      redirect = `/room/${room_pin}`;
    } else {
      // playing
      redirect = `/room/${room_pin}/play`;
    }

    return NextResponse.json({ room, player, redirect });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
