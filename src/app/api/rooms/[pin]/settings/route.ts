import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROUND_COUNT_OPTIONS } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const body = await request.json().catch(() => ({}));
    const { max_rounds } = body as { max_rounds?: unknown };

    if (
      typeof max_rounds !== "number" ||
      !Number.isInteger(max_rounds) ||
      !ROUND_COUNT_OPTIONS.includes(max_rounds as (typeof ROUND_COUNT_OPTIONS)[number])
    ) {
      return NextResponse.json({ error: "Invalid round count" }, { status: 400 });
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
        { status: 403 }
      );
    }

    const { data: updatedRoom, error } = await adminSupabase
      .from("rooms")
      .update({
        settings: {
          ...(typeof room.settings === "object" && room.settings ? room.settings : {}),
          max_rounds,
        },
      })
      .eq("id", room.id)
      .select("id, pin, host_player_id, settings")
      .single();

    if (error || !updatedRoom) {
      return NextResponse.json(
        { error: "Failed to update room settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ room: updatedRoom });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
