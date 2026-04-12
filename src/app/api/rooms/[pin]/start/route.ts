import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assignRoundOrder, calculateTotalRounds } from "@/lib/game";
import type { RoomSettings } from "@/lib/types";

/**
 * POST /api/rooms/[pin]/start — Start the game
 *
 * New flow (Chrome Extension pipeline):
 * 1. Verify all players have sync_status = 'synced'
 * 2. Read synced likes from the `likes` table
 * 3. Insert videos into DB from likes
 * 4. Randomly distribute videos across rounds (non-flat distribution)
 * 5. Create first round and start the game
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const body = await request.json().catch(() => ({}));
    const { player_id } = body as { player_id?: string };
    const supabase = await createClient();

    // Get room
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .eq("status", "lobby")
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { error: "Room not found or already started" },
        { status: 404 }
      );
    }

    // Verify caller is the host
    if (player_id && room.host_player_id && player_id !== room.host_player_id) {
      return NextResponse.json(
        { error: "Only the host can start the game" },
        { status: 403 }
      );
    }

    // Get players
    const { data: players } = await supabase
      .from("players")
      .select("id, tiktok_username, nickname, sync_status")
      .eq("room_id", room.id);

    if (!players || players.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 players" },
        { status: 400 }
      );
    }

    // Check all players have synced their TikTok likes
    const unsyncedPlayers = players.filter((p) => p.sync_status !== "synced");
    if (unsyncedPlayers.length > 0) {
      const names = unsyncedPlayers.map((p) => p.nickname);
      return NextResponse.json(
        {
          error: `Players have not synced their TikTok likes: ${names.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const settings = room.settings as RoomSettings;
    const totalRounds = calculateTotalRounds(players.length, settings);

    // Read synced likes from the likes table for all players in this room
    const { data: allLikes, error: likesError } = await supabase
      .from("likes")
      .select("*")
      .eq("room_id", room.id);

    if (likesError || !allLikes || allLikes.length === 0) {
      return NextResponse.json(
        { error: "No synced likes found. All players must sync their TikTok likes first." },
        { status: 400 }
      );
    }

    // Group likes by player
    const likesByPlayer = new Map<
      string,
      Array<{
        tiktok_url: string | null;
        video_url: string | null;
        video_urls: string[];
        tiktok_video_id: string;
      }>
    >();
    for (const like of allLikes) {
      const rawVideoUrls = Array.isArray(like.video_urls) ? like.video_urls : [];
      const mergedUrls = [...rawVideoUrls, like.video_url].filter(
        (url, index, arr) =>
          typeof url === "string" &&
          /^https?:\/\//i.test(url) &&
          arr.indexOf(url) === index
      ) as string[];

      const existing = likesByPlayer.get(like.player_id) || [];
      existing.push({
        tiktok_url: like.tiktok_url,
        video_url: mergedUrls[0] ?? null,
        video_urls: mergedUrls,
        tiktok_video_id: like.tiktok_video_id,
      });
      likesByPlayer.set(like.player_id, existing);
    }

    // Verify each player has at least 1 like
    const emptyPlayers = players.filter(
      (p) => !likesByPlayer.has(p.id) || likesByPlayer.get(p.id)!.length === 0
    );
    if (emptyPlayers.length > 0) {
      const emptyNames = emptyPlayers.map((p) => p.nickname);
      return NextResponse.json(
        {
          error: `No synced likes found for: ${emptyNames.join(", ")}. They need to sync again.`,
        },
        { status: 400 }
      );
    }

    // Delete any existing videos for this room (clean start)
    await supabase.from("videos").delete().eq("room_id", room.id);

    const roundAssignments = assignRoundOrder(
      new Map(
        Array.from(likesByPlayer.entries()).map(([playerId, likes]) => [
          playerId,
          likes.map((like) => ({
            tiktokUrl: like.tiktok_url,
            videoUrl: like.video_url,
            videoUrls: like.video_urls,
            tiktokVideoId: like.tiktok_video_id,
          })),
        ])
      ),
      totalRounds
    );

    const actualTotalRounds = roundAssignments.length;
    if (actualTotalRounds === 0) {
      return NextResponse.json(
        { error: "Not enough videos to start the game" },
        { status: 400 }
      );
    }

    // Insert all videos into DB
    const videoRows = roundAssignments.map((ra) => ({
      room_id: room.id,
      player_id: ra.playerId,
      tiktok_url: ra.tiktokUrl,
      tiktok_video_id: ra.tiktokVideoId,
      video_url: ra.videoUrl,
      video_urls: ra.videoUrls,
      planned_round_number: ra.plannedRoundNumber,
      used: false,
    }));

    const { data: insertedVideos, error: videoInsertError } = await supabase
      .from("videos")
      .insert(videoRows)
      .select();

    if (videoInsertError || !insertedVideos) {
      return NextResponse.json(
        { error: "Failed to save videos" },
        { status: 500 }
      );
    }

    // Pick first video and create first round (no deadline — timer-free)
    const firstVideoRow = insertedVideos[0];
    await supabase
      .from("videos")
      .update({ used: true })
      .eq("id", firstVideoRow.id);

    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .insert({
        room_id: room.id,
        round_number: 1,
        video_id: firstVideoRow.id,
        correct_player_id: firstVideoRow.player_id,
        status: "voting",
        deadline: null,
      })
      .select()
      .single();

    if (roundError || !round) {
      await supabase
        .from("videos")
        .update({ used: false })
        .eq("id", firstVideoRow.id);
      return NextResponse.json(
        { error: "Failed to create first round" },
        { status: 500 }
      );
    }

    // Update room status
    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "playing",
        current_round: 1,
        settings: {
          ...(room.settings as object),
          total_rounds: actualTotalRounds,
        },
      })
      .eq("id", room.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update room status" },
        { status: 500 }
      );
    }

    return NextResponse.json({ round, totalRounds: actualTotalRounds });
  } catch (err) {
    console.error("Game start error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
