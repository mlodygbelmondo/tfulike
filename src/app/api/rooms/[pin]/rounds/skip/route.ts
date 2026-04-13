import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function getRoundContext(pin: string) {
  const supabase = await createClient();
  const adminSupabase = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("pin", pin)
    .eq("status", "playing")
    .single();

  if (!room) {
    return { error: NextResponse.json({ error: "Room not found" }, { status: 404 }) };
  }

  const { data: player } = await supabase
    .from("players")
    .select("id, user_id")
    .eq("room_id", room.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!player) {
    return {
      error: NextResponse.json({ error: "You are not a player in this room" }, { status: 403 }),
    };
  }

  const { data: round } = await supabase
    .from("rounds")
    .select("*")
    .eq("room_id", room.id)
    .eq("round_number", room.current_round)
    .eq("status", "voting")
    .single();

  if (!round) {
    return { error: NextResponse.json({ error: "No active voting round" }, { status: 400 }) };
  }

  const { data: players } = await adminSupabase
    .from("players")
    .select("id")
    .eq("room_id", room.id);

  return {
    supabase,
    adminSupabase,
    room,
    round,
    player,
    playerCount: players?.length ?? 0,
  };
}

async function buildSkipState(adminSupabase: ReturnType<typeof createAdminClient>, roundId: string) {
  const { data: skips } = await adminSupabase
    .from("round_skips")
    .select("player_id")
    .eq("round_id", roundId);

  const skippedPlayerIds = (skips ?? []).map((skip) => skip.player_id);

  return {
    skipCount: skippedPlayerIds.length,
    skippedPlayerIds,
  };
}

async function ensureMutationSucceeded(
  operation: Promise<{ error: { message?: string } | null }>,
  message: string
) {
  const { error } = await operation;

  if (error) {
    throw new Error(error.message || message);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const context = await getRoundContext(pin);
    if ("error" in context) return context.error;

    const { adminSupabase, room, round, player, playerCount } = context;

    await adminSupabase
      .from("round_skips")
      .insert({ round_id: round.id, player_id: player.id })
      .select()
      .maybeSingle();

    const { skipCount, skippedPlayerIds } = await buildSkipState(adminSupabase, round.id);
    const allSkipped = playerCount > 0 && skipCount >= playerCount;

    if (!allSkipped) {
      return NextResponse.json({
        all_skipped: false,
        finished: false,
        replacement_applied: false,
        skip_count: skipCount,
        player_count: playerCount,
        skipped_player_ids: skippedPlayerIds,
      });
    }

    const totalRounds = Number((room.settings as Record<string, unknown>)?.total_rounds ?? 0);
    const { data: replacementVideo } = await adminSupabase
      .from("videos")
      .select("id, player_id, planned_round_number")
      .eq("room_id", room.id)
      .eq("used", false)
      .gt("planned_round_number", round.round_number)
      .order("planned_round_number", { ascending: true })
      .maybeSingle();

    if (!replacementVideo) {
      await ensureMutationSucceeded(
        adminSupabase.from("votes").delete().eq("round_id", round.id),
        "Failed to clear round votes"
      );
      await ensureMutationSucceeded(
        adminSupabase.from("round_skips").delete().eq("round_id", round.id),
        "Failed to clear round skips"
      );
      await ensureMutationSucceeded(
        adminSupabase
          .from("rounds")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", round.id),
        "Failed to finish skipped round"
      );
      await ensureMutationSucceeded(
        adminSupabase.from("rooms").update({ status: "finished" }).eq("id", room.id),
        "Failed to finish room"
      );

      return NextResponse.json({
        all_skipped: true,
        finished: true,
        replacement_applied: false,
        skip_count: playerCount,
        player_count: playerCount,
        skipped_player_ids: skippedPlayerIds,
      });
    }

    const { data: claimedRound, error: claimError } = await adminSupabase
      .from("rounds")
      .update({
        video_id: replacementVideo.id,
        correct_player_id: replacementVideo.player_id,
      })
      .eq("id", round.id)
      .eq("status", "voting")
      .eq("video_id", round.video_id)
      .select("id")
      .maybeSingle();

    if (claimError) {
      return NextResponse.json({ error: "Failed to resolve skip" }, { status: 500 });
    }

    if (!claimedRound) {
      return NextResponse.json({
        all_skipped: true,
        finished: false,
        replacement_applied: true,
        replacement_video_id: replacementVideo.id,
        skip_count: playerCount,
        player_count: playerCount,
        skipped_player_ids: skippedPlayerIds,
      });
    }

    await ensureMutationSucceeded(
      adminSupabase.from("votes").delete().eq("round_id", round.id),
      "Failed to clear round votes"
    );
    await ensureMutationSucceeded(
      adminSupabase.from("round_skips").delete().eq("round_id", round.id),
      "Failed to clear round skips"
    );

    const { data: laterVideos } = await adminSupabase
      .from("videos")
      .select("id, planned_round_number")
      .eq("room_id", room.id)
      .gt("planned_round_number", replacementVideo.planned_round_number)
      .order("planned_round_number", { ascending: true });

    await ensureMutationSucceeded(
      adminSupabase
        .from("videos")
        .update({ planned_round_number: null, used: true })
        .eq("id", round.video_id),
      "Failed to retire skipped video"
    );

    await ensureMutationSucceeded(
      adminSupabase
        .from("videos")
        .update({ used: true, planned_round_number: round.round_number })
        .eq("id", replacementVideo.id),
      "Failed to activate replacement video"
    );

    for (const video of laterVideos ?? []) {
      await ensureMutationSucceeded(
        adminSupabase
          .from("videos")
          .update({ planned_round_number: (video.planned_round_number as number) - 1 })
          .eq("id", video.id),
        "Failed to shift later video order"
      );
    }

    await ensureMutationSucceeded(
      adminSupabase
        .from("rooms")
        .update({
          settings: {
            ...(room.settings as object),
            total_rounds: Math.max(round.round_number, totalRounds - 1),
          },
        })
        .eq("id", room.id),
      "Failed to shrink total rounds"
    );

    return NextResponse.json({
      all_skipped: true,
      finished: false,
      replacement_applied: true,
      replacement_video_id: replacementVideo.id,
      skip_count: playerCount,
      player_count: playerCount,
      skipped_player_ids: skippedPlayerIds,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const context = await getRoundContext(pin);
    if ("error" in context) return context.error;

    const { adminSupabase, round, player, playerCount } = context;

    await adminSupabase
      .from("round_skips")
      .delete()
      .eq("round_id", round.id)
      .eq("player_id", player.id);

    const { skipCount, skippedPlayerIds } = await buildSkipState(adminSupabase, round.id);

    return NextResponse.json({
      all_skipped: false,
      finished: false,
      replacement_applied: false,
      skip_count: skipCount,
      player_count: playerCount,
      skipped_player_ids: skippedPlayerIds,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
