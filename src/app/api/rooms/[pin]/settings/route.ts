import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAYBACK_MODE_OPTIONS, ROUND_COUNT_OPTIONS } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> },
) {
  try {
    const { pin } = await params;
    const parsedBody = await request.json().catch(() => ({}));
    const body =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>)
        : {};
    const { max_rounds, playback_mode } = body as {
      max_rounds?: unknown;
      playback_mode?: unknown;
    };

    const hasRoundCount = "max_rounds" in body;
    const hasPlaybackMode = "playback_mode" in body;

    if (!hasRoundCount && !hasPlaybackMode) {
      return NextResponse.json(
        { error: "No settings provided" },
        { status: 400 },
      );
    }

    if (
      hasRoundCount &&
      (typeof max_rounds !== "number" ||
        !Number.isInteger(max_rounds) ||
        !ROUND_COUNT_OPTIONS.includes(
          max_rounds as (typeof ROUND_COUNT_OPTIONS)[number],
        ))
    ) {
      return NextResponse.json(
        { error: "Invalid round count" },
        { status: 400 },
      );
    }

    if (
      hasPlaybackMode &&
      (typeof playback_mode !== "string" ||
        !PLAYBACK_MODE_OPTIONS.includes(
          playback_mode as (typeof PLAYBACK_MODE_OPTIONS)[number],
        ))
    ) {
      return NextResponse.json(
        { error: "Invalid playback mode" },
        { status: 400 },
      );
    }

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
      .select("id, pin, host_player_id, settings")
      .eq("pin", pin)
      .single();

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: callerPlayer } = await supabase
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerPlayer || callerPlayer.id !== room.host_player_id) {
      return NextResponse.json(
        { error: "Only the host can update room settings" },
        { status: 403 },
      );
    }

    const { data: updatedRoom, error } = await adminSupabase
      .from("rooms")
      .update({
        settings: {
          ...(typeof room.settings === "object" && room.settings
            ? room.settings
            : {}),
          ...(hasRoundCount ? { max_rounds } : {}),
          ...(hasPlaybackMode ? { playback_mode } : {}),
        },
      })
      .eq("id", room.id)
      .select("id, pin, host_player_id, settings")
      .single();

    if (error || !updatedRoom) {
      return NextResponse.json(
        { error: "Failed to update room settings" },
        { status: 500 },
      );
    }

    return NextResponse.json({ room: updatedRoom });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
