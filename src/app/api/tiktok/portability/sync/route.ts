import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addDataRequest,
  checkDataRequest,
  downloadDataArchive,
  extractLikesFromArchive,
  isPortabilityEnabled,
  refreshTokens,
} from "@/lib/tiktok-portability";

type AdminClient = ReturnType<typeof createAdminClient>;

interface TikTokConnectionRow {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: string | null;
}

async function getFreshConnection(
  adminSupabase: AdminClient,
  userId: string,
): Promise<TikTokConnectionRow | null> {
  const { data: connection } = await adminSupabase
    .from("tiktok_connections")
    .select("user_id, access_token, refresh_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!connection) return null;

  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;

  // Refresh with a 60s safety margin.
  if (expiresAt > Date.now() + 60_000) {
    return connection;
  }

  if (!connection.refresh_token) return null;

  try {
    const tokens = await refreshTokens(connection.refresh_token);
    const now = Date.now();

    await adminSupabase
      .from("tiktok_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? connection.refresh_token,
        access_token_expires_at: new Date(
          now + tokens.expires_in * 1000,
        ).toISOString(),
        updated_at: new Date(now).toISOString(),
      })
      .eq("user_id", userId);

    return {
      ...connection,
      access_token: tokens.access_token,
    };
  } catch {
    return null;
  }
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST() {
  if (!isPortabilityEnabled()) {
    return NextResponse.json(
      { error: "TikTok portability is not enabled" },
      { status: 404 },
    );
  }

  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminSupabase = createAdminClient();
    const connection = await getFreshConnection(adminSupabase, user.id);
    if (!connection) {
      return NextResponse.json(
        { error: "TikTok account not connected" },
        { status: 409 },
      );
    }

    const requestId = await addDataRequest(connection.access_token);

    await adminSupabase.from("tiktok_data_requests").insert({
      user_id: user.id,
      request_id: requestId,
      status: "pending",
    });

    return NextResponse.json({ request_id: requestId, status: "pending" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  if (!isPortabilityEnabled()) {
    return NextResponse.json(
      { error: "TikTok portability is not enabled" },
      { status: 404 },
    );
  }

  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminSupabase = createAdminClient();

    const { data: dataRequest } = await adminSupabase
      .from("tiktok_data_requests")
      .select("id, request_id, status, likes_imported")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!dataRequest) {
      return NextResponse.json({ status: "none" });
    }

    if (dataRequest.status === "imported") {
      return NextResponse.json({
        status: "imported",
        likes_imported: dataRequest.likes_imported,
      });
    }

    const connection = await getFreshConnection(adminSupabase, user.id);
    if (!connection) {
      return NextResponse.json(
        { error: "TikTok account not connected" },
        { status: 409 },
      );
    }

    const status = await checkDataRequest(
      connection.access_token,
      dataRequest.request_id,
    );

    if (status !== "downloading") {
      await adminSupabase
        .from("tiktok_data_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", dataRequest.id);

      return NextResponse.json({ status });
    }

    // Archive is ready: download, extract likes, import.
    const archive = await downloadDataArchive(
      connection.access_token,
      dataRequest.request_id,
    );
    const likes = extractLikesFromArchive(archive);

    if (likes.length > 0) {
      const rows = likes.map((like) => ({
        user_id: user.id,
        tiktok_video_id: like.tiktok_video_id,
        tiktok_url: like.tiktok_url,
        video_url: null,
        video_urls: [],
        author_username: null,
        description: null,
        cover_url: null,
      }));

      const { error: upsertError } = await adminSupabase
        .from("user_likes")
        .upsert(rows, {
          onConflict: "user_id,tiktok_video_id",
          ignoreDuplicates: true,
        });

      if (upsertError) {
        return NextResponse.json(
          { error: "Failed to import likes" },
          { status: 500 },
        );
      }
    }

    await adminSupabase
      .from("profiles")
      .update({
        sync_status: "synced",
        sync_error: null,
        synced_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    await adminSupabase
      .from("tiktok_data_requests")
      .update({
        status: "imported",
        likes_imported: likes.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dataRequest.id);

    return NextResponse.json({
      status: "imported",
      likes_imported: likes.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
