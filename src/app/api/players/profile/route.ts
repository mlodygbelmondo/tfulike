import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTikTokUsername } from "@/lib/game";

// POST /api/players/profile — Update active player profile using stored session
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      player_id,
      session_token,
      room_pin,
      nickname,
      color,
      tiktok_username,
    } = body as {
      player_id?: string;
      session_token?: string;
      room_pin?: string;
      nickname?: string;
      color?: string;
      tiktok_username?: string;
    };

    const normalizedNickname = nickname?.trim();
    const normalizedTikTok = parseTikTokUsername(tiktok_username || "");

    if (
      !player_id ||
      !session_token ||
      !room_pin ||
      !normalizedNickname ||
      !color ||
      !normalizedTikTok
    ) {
      return NextResponse.json(
        { error: "player_id, session_token, room_pin, nickname, color, and valid tiktok_username are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("id, room_id, session_token")
      .eq("id", player_id)
      .eq("session_token", session_token)
      .single();

    if (playerError || !player) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, pin")
      .eq("pin", room_pin)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (player.room_id !== room.id) {
      return NextResponse.json(
        { error: "Player does not belong to this room" },
        { status: 403 }
      );
    }

    const { data: updatedPlayer, error: updateError } = await supabase
      .from("players")
      .update({
        nickname: normalizedNickname,
        color,
        tiktok_username: normalizedTikTok,
      })
      .eq("id", player_id)
      .select()
      .single();

    if (updateError || !updatedPlayer) {
      return NextResponse.json(
        { error: "Failed to update player profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ player: updatedPlayer });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
