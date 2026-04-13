import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/rooms/reconnect — Reconnect to a room using Supabase Auth
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { room_pin } = body;

    if (!room_pin) {
      return NextResponse.json(
        { error: "room_pin is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Find the room
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

    // Find the player by user_id in this room
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { error: "Player not found in this room" },
        { status: 404 }
      );
    }

    // Room is finished
    if (room.status === "finished") {
      return NextResponse.json({
        room,
        player,
        redirect: `/room/${room_pin}/results`,
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
