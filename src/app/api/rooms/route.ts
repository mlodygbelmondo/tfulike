import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/rooms — Create a new room (requires auth)
export async function POST() {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    // Require authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get profile for nickname, color and sync metadata.
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
    const { data: room, error: roomError } = await adminSupabase
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

    // Create host player linked to auth user
    const { data: player, error: playerError } = await adminSupabase
      .from("players")
      .insert({
        room_id: room.id,
        user_id: user.id,
        nickname: profile.nickname,
        color: profile.color,
        tiktok_username: profile.tiktok_username,
        sync_status: profile.sync_status,
        synced_at: profile.synced_at,
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
    await adminSupabase
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
