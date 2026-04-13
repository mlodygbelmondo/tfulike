import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAYER_COLORS } from "@/lib/types";

// POST /api/rooms/join — Join an existing room (requires auth)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pin } = body;

    if (!pin) {
      return NextResponse.json(
        { error: "PIN is required" },
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
    const adminSupabase = createAdminClient();

    // Require authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get profile and carry over sync metadata into the room player row.
    const { data: profile } = await supabase
      .from("profiles")
      .select("nickname, color, tiktok_username, sync_status, synced_at, onboarding_completed")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found. Complete onboarding first." },
        { status: 400 }
      );
    }

    if (!profile.onboarding_completed) {
      return NextResponse.json(
        { error: "Complete onboarding first." },
        { status: 400 }
      );
    }

    // Find room by PIN
    const { data: room, error: roomError } = await adminSupabase
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
    const { count } = await adminSupabase
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id);

    if ((count || 0) >= 8) {
      return NextResponse.json({ error: "Room is full (max 8)" }, { status: 400 });
    }

    // Check if user already joined this room
    const { data: existingPlayer } = await adminSupabase
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .single();

    if (existingPlayer) {
      // User already in room — return existing player
      return NextResponse.json({ room, player: existingPlayer });
    }

    // Check for duplicate nickname in room
    const { data: duplicateNickname } = await adminSupabase
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("nickname", profile.nickname)
      .single();

    const nickname = duplicateNickname
      ? `${profile.nickname} ${(count || 0) + 1}`
      : profile.nickname;

    // Check color availability and resolve conflicts
    const { data: existingColors } = await adminSupabase
      .from("players")
      .select("color")
      .eq("room_id", room.id);

    const takenColors = existingColors?.map((p) => p.color) || [];
    let finalColor = profile.color;
    if (takenColors.includes(profile.color)) {
      const available = PLAYER_COLORS.find((c) => !takenColors.includes(c));
      if (!available) {
        return NextResponse.json(
          { error: "No colors available" },
          { status: 400 }
        );
      }
      finalColor = available;
    }

    // Create player linked to auth user
    const { data: player, error: playerError } = await adminSupabase
      .from("players")
      .insert({
        room_id: room.id,
        user_id: user.id,
        nickname,
        color: finalColor,
        tiktok_username: profile.tiktok_username,
        sync_status: profile.sync_status,
        synced_at: profile.synced_at,
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
