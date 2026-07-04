import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function normalizeVideoUrls(body: Record<string, unknown>): string[] {
  const candidates = [
    ...(Array.isArray(body.video_urls) ? body.video_urls : []),
    body.video_url,
  ];

  const urls: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const url = candidate.trim();
    if (!/^https:\/\/.+/i.test(url)) continue;
    if (urls.includes(url)) continue;
    urls.push(url);
  }

  return urls;
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
    const videoUrls = normalizeVideoUrls(body);

    if (videoUrls.length === 0) {
      return NextResponse.json(
        { error: "No valid video URLs provided" },
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

    const { data: video } = await adminSupabase
      .from("videos")
      .select("id, room_id")
      .eq("id", id)
      .single();

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const { data: room } = await adminSupabase
      .from("rooms")
      .select("id, host_player_id")
      .eq("id", video.room_id)
      .single();

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: callerPlayer } = await adminSupabase
      .from("players")
      .select("id")
      .eq("room_id", video.room_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerPlayer || callerPlayer.id !== room.host_player_id) {
      return NextResponse.json(
        { error: "Only the host can update video sources" },
        { status: 403 },
      );
    }

    const { data: updatedVideo, error } = await adminSupabase
      .from("videos")
      .update({
        video_url: videoUrls[0],
        video_urls: videoUrls,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !updatedVideo) {
      return NextResponse.json(
        { error: "Failed to update video sources" },
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
