import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "video-cache";
const SIGNED_READ_URL_TTL_SECONDS = 60 * 60;

type AdminClient = ReturnType<typeof createAdminClient>;

async function loadVideo(adminSupabase: AdminClient, id: string) {
  const { data: video } = await adminSupabase
    .from("videos")
    .select("id, room_id, storage_path, cache_status")
    .eq("id", id)
    .single();

  return video;
}

async function requireHost(
  adminSupabase: AdminClient,
  roomId: string,
  userId: string,
) {
  const { data: room } = await adminSupabase
    .from("rooms")
    .select("id, host_player_id")
    .eq("id", roomId)
    .single();

  if (!room) return false;

  const { data: callerPlayer } = await adminSupabase
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(callerPlayer && callerPlayer.id === room.host_player_id);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const adminSupabase = createAdminClient();

    const video = await loadVideo(adminSupabase, id);
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (video.cache_status !== "ready" || !video.storage_path) {
      return NextResponse.json({ error: "Video not cached" }, { status: 404 });
    }

    const { data, error } = await adminSupabase.storage
      .from(BUCKET)
      .createSignedUrl(video.storage_path, SIGNED_READ_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: "Failed to create signed URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsedBody = await request.json().catch(() => ({}));
    const body =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>)
        : {};
    const action = body.action;

    if (
      action !== "upload-url" &&
      action !== "complete" &&
      action !== "failed"
    ) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const video = await loadVideo(adminSupabase, id);
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const isHost = await requireHost(adminSupabase, video.room_id, user.id);
    if (!isHost) {
      return NextResponse.json(
        { error: "Only the host can manage the video cache" },
        { status: 403 },
      );
    }

    if (action === "upload-url") {
      const storagePath = `${video.room_id}/${video.id}.mp4`;
      const { data, error } = await adminSupabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error || !data?.signedUrl) {
        return NextResponse.json(
          { error: "Failed to create upload URL" },
          { status: 500 },
        );
      }

      await adminSupabase
        .from("videos")
        .update({ cache_status: "uploading" })
        .eq("id", id);

      return NextResponse.json({
        upload: {
          signedUrl: data.signedUrl,
          token: data.token,
          path: storagePath,
        },
      });
    }

    const update =
      action === "complete"
        ? {
            cache_status: "ready",
            storage_path: `${video.room_id}/${video.id}.mp4`,
            cached_at: new Date().toISOString(),
          }
        : { cache_status: "failed" };

    const { data: updatedVideo, error } = await adminSupabase
      .from("videos")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !updatedVideo) {
      return NextResponse.json(
        { error: "Failed to update cache status" },
        { status: 500 },
      );
    }

    return NextResponse.json({ video: updatedVideo });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
