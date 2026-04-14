import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface LikePayload {
  tiktok_video_id: string;
  tiktok_url?: string;
  video_url?: string;
  video_urls?: string[];
  author_username?: string;
  description?: string;
  cover_url?: string;
}

type VideoCollectionTable = "user_likes" | "user_bookmarks";

function normalizeVideoUrls(like: LikePayload): string[] {
  const candidateList = [
    ...(Array.isArray(like.video_urls) ? like.video_urls : []),
    like.video_url,
  ];

  const deduped: string[] = [];
  for (const raw of candidateList) {
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (deduped.includes(url)) continue;
    deduped.push(url);
  }

  return deduped;
}

async function upsertVideoCollection(
  adminSupabase: ReturnType<typeof createAdminClient>,
  table: VideoCollectionTable,
  userId: string,
  videos: LikePayload[]
) {
  if (videos.length === 0) {
    return { error: null as { message: string } | null };
  }

  const rows = videos.map((video) => {
    const videoUrls = normalizeVideoUrls(video);
    return {
      user_id: userId,
      tiktok_video_id: video.tiktok_video_id,
      tiktok_url: video.tiktok_url ?? null,
      video_url: videoUrls[0] ?? null,
      video_urls: videoUrls,
      author_username: video.author_username ?? null,
      description: video.description ?? null,
      cover_url: video.cover_url ?? null,
    };
  });

  return adminSupabase.from(table).upsert(rows, {
    onConflict: "user_id,tiktok_video_id",
    ignoreDuplicates: false,
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const tiktokUsername =
      typeof body?.tiktok_username === "string" ? body.tiktok_username.trim() : "";
    const likes: LikePayload[] = Array.isArray(body?.likes) ? body.likes : null;
    const bookmarks: LikePayload[] = Array.isArray(body?.bookmarks) ? body.bookmarks : [];

    if (!tiktokUsername || !likes) {
      return NextResponse.json(
        { error: "Missing required fields: tiktok_username, likes[]" },
        { status: 400 }
      );
    }

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 });
    }

    await adminSupabase
      .from("profiles")
      .update({
        sync_status: "syncing",
        sync_error: null,
        tiktok_username: tiktokUsername,
      })
      .eq("id", user.id);

    const collections: Array<{ table: VideoCollectionTable; label: string; videos: LikePayload[] }> = [
      { table: "user_likes", label: "likes", videos: likes },
      { table: "user_bookmarks", label: "bookmarks", videos: bookmarks },
    ];

    for (const collection of collections) {
      const { error: upsertError } = await upsertVideoCollection(
        adminSupabase,
        collection.table,
        user.id,
        collection.videos
      );

      if (upsertError) {
        await adminSupabase
          .from("profiles")
          .update({
            sync_status: "error",
            sync_error: upsertError.message,
          })
          .eq("id", user.id);

        return NextResponse.json(
          {
            error: `Failed to upsert ${collection.label}`,
            detail: upsertError.message,
          },
          { status: 500 }
        );
      }
    }

    const hasLikes = likes.length > 0;
    const syncedAt = hasLikes ? new Date().toISOString() : null;
    const syncedUpdates = {
      sync_status: hasLikes ? "synced" : "idle",
      sync_error: null,
      tiktok_username: tiktokUsername,
      synced_at: syncedAt,
    };

    await adminSupabase.from("profiles").update(syncedUpdates).eq("id", user.id);
    await adminSupabase.from("players").update(syncedUpdates).eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      synced_count: likes.length + bookmarks.length,
      tiktok_username: tiktokUsername,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal error", detail: String(err) },
      { status: 500 }
    );
  }
}
