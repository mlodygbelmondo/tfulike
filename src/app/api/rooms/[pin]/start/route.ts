import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignRoundOrder, calculateTotalRounds } from "@/lib/game";
import type { RoomSettings } from "@/lib/types";

/**
 * POST /api/rooms/[pin]/start — Start the game
 *
 * Auth-based flow:
 * 1. Verify caller is the host (via auth user_id → player.user_id)
 * 2. Check profile sync_status for all players
 * 3. Read global user_likes for each player's user_id
 * 4. Insert videos into DB from likes
 * 5. Randomly distribute videos across rounds
 * 6. Create first round and start the game
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  try {
    const { pin } = await params;
    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    // Require authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Get players with user_id
    const { data: players } = await adminSupabase
      .from("players")
      .select("id, user_id, tiktok_username, nickname, sync_status")
      .eq("room_id", room.id);

    if (!players || players.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 players" },
        { status: 400 }
      );
    }

    // Verify caller is the host (via user_id match)
    const callerPlayer = players.find((p) => p.user_id === user.id);
    if (!callerPlayer || callerPlayer.id !== room.host_player_id) {
      return NextResponse.json(
        { error: "Only the host can start the game" },
        { status: 403 }
      );
    }

    // All players must have user_id (auth required)
    const userIds = players
      .filter((p) => p.user_id)
      .map((p) => p.user_id!);

    // Check profiles' sync_status for all authenticated players
    if (userIds.length > 0) {
      const { data: profiles } = await adminSupabase
        .from("profiles")
        .select("id, sync_status, nickname")
        .in("id", userIds);

      const unsyncedProfiles = (profiles ?? []).filter(
        (p) => p.sync_status !== "synced"
      );
      if (unsyncedProfiles.length > 0) {
        const names = unsyncedProfiles.map((p) => p.nickname);
        return NextResponse.json(
          {
            error: `Players have not synced their TikTok likes: ${names.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const settings = room.settings as RoomSettings;
    const totalRounds = calculateTotalRounds(players.length, settings);

    // Read global user_likes for all players
    const likesByPlayer = new Map<
      string,
      Array<{
        tiktok_url: string | null;
        video_url: string | null;
        video_urls: string[];
        tiktok_video_id: string;
      }>
    >();

    if (userIds.length > 0) {
      const { data: userLikes } = await adminSupabase
        .from("user_likes")
        .select("*")
        .in("user_id", userIds);

      if (userLikes) {
        // Map user_id → player_id
        const userToPlayer = new Map(
          players
            .filter((p) => p.user_id)
            .map((p) => [p.user_id!, p.id])
        );

        for (const like of userLikes) {
          const playerId = userToPlayer.get(like.user_id);
          if (!playerId) continue;

          const rawVideoUrls = Array.isArray(like.video_urls) ? like.video_urls : [];
          const mergedUrls = [...rawVideoUrls, like.video_url].filter(
            (url, index, arr) =>
              typeof url === "string" &&
              /^https?:\/\//i.test(url) &&
              arr.indexOf(url) === index
          ) as string[];

          const existing = likesByPlayer.get(playerId) || [];
          existing.push({
            tiktok_url: like.tiktok_url,
            video_url: mergedUrls[0] ?? null,
            video_urls: mergedUrls,
            tiktok_video_id: like.tiktok_video_id,
          });
          likesByPlayer.set(playerId, existing);
        }
      }
    }

    if (likesByPlayer.size === 0) {
      return NextResponse.json(
        { error: "No synced likes found. All players must sync their TikTok likes first." },
        { status: 400 }
      );
    }

    // Check if any player has no likes at all
    const playersWithoutLikes = players.filter(
      (p) => p.user_id && !likesByPlayer.has(p.id)
    );
    if (playersWithoutLikes.length > 0) {
      const names = playersWithoutLikes.map((p) => p.nickname);
      return NextResponse.json(
        {
          error: `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no likes. Please sync again.`,
        },
        { status: 400 }
      );
    }

    // Delete any existing videos for this room (clean start)
    await adminSupabase.from("videos").delete().eq("room_id", room.id);

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

    const { data: insertedVideos, error: videoInsertError } = await adminSupabase
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
    await adminSupabase
      .from("videos")
      .update({ used: true })
      .eq("id", firstVideoRow.id);

    const { data: round, error: roundError } = await adminSupabase
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
      await adminSupabase
        .from("videos")
        .update({ used: false })
        .eq("id", firstVideoRow.id);
      return NextResponse.json(
        { error: "Failed to create first round" },
        { status: 500 }
      );
    }

    // Update room status
    const { error: updateError } = await adminSupabase
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
