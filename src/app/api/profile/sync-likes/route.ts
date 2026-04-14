import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface LikePayload {
  tiktok_video_id: string;
  tiktok_url?: string;
  media_type?: "video" | "photo_gallery";
  video_url?: string;
  video_urls?: string[];
  image_urls?: string[];
  audio_url?: string;
  author_username?: string;
  description?: string;
  cover_url?: string;
}

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

function normalizeImageUrls(like: LikePayload): string[] {
  const candidateList = Array.isArray(like.image_urls) ? like.image_urls : [];

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

function normalizeAudioUrl(like: LikePayload): string | null {
  if (typeof like.audio_url !== "string") return null;
  const url = like.audio_url.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
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

    if (likes.length > 0) {
      const rows = likes.map((like) => {
        const mediaType = like.media_type === "photo_gallery" ? "photo_gallery" : "video";
        const videoUrls = normalizeVideoUrls(like);
        const imageUrls = normalizeImageUrls(like);
        const audioUrl = normalizeAudioUrl(like);
        return {
          user_id: user.id,
          tiktok_video_id: like.tiktok_video_id,
          tiktok_url: like.tiktok_url ?? null,
          media_type: mediaType,
          video_url: mediaType === "video" ? videoUrls[0] ?? null : null,
          video_urls: mediaType === "video" ? videoUrls : [],
          image_urls: mediaType === "photo_gallery" ? imageUrls : [],
          audio_url: mediaType === "photo_gallery" ? audioUrl : null,
          author_username: like.author_username ?? null,
          description: like.description ?? null,
          cover_url: like.cover_url ?? null,
        };
      });

      const { error: upsertError } = await adminSupabase.from("user_likes").upsert(rows, {
        onConflict: "user_id,tiktok_video_id",
        ignoreDuplicates: false,
      });

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
            error: "Failed to upsert likes",
            detail: upsertError.message,
          },
          { status: 500 }
        );
      }
    }

    const syncedAt = new Date().toISOString();
    const syncedUpdates = {
      sync_status: "synced",
      sync_error: null,
      tiktok_username: tiktokUsername,
      synced_at: syncedAt,
    };

    await adminSupabase.from("profiles").update(syncedUpdates).eq("id", user.id);
    await adminSupabase.from("players").update(syncedUpdates).eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      synced_count: likes.length,
      tiktok_username: tiktokUsername,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal error", detail: String(err) },
      { status: 500 }
    );
  }
}
