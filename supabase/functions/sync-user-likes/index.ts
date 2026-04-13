// supabase/functions/sync-user-likes/index.ts
// Edge Function: receives parsed TikTok likes from the Chrome Extension
// and upserts them into the global `user_likes` table (per-user, not per-room).
// Also updates the profile sync_status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LikePayload {
  tiktok_video_id: string;
  tiktok_url?: string;
  video_url?: string;
  video_urls?: string[];
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

interface SyncRequest {
  /** Auth user ID (profiles.id) */
  user_id: string;
  /** Logged-in TikTok username resolved by the extension */
  tiktok_username?: string;
  likes: LikePayload[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Invalid bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: SyncRequest = await req.json();
    const { user_id, tiktok_username, likes } = body;

    if (!user_id || !tiktok_username || !Array.isArray(likes)) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: user_id, tiktok_username, likes[]",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (authUser.id !== user_id) {
      return new Response(JSON.stringify({ error: "User ID mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user exists in profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user_id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Mark profile as syncing
    await supabase
      .from("profiles")
      .update({
        sync_status: "syncing",
        sync_error: null,
        tiktok_username,
      })
      .eq("id", user_id);

    // Upsert likes into user_likes
    if (likes.length > 0) {
      const rows = likes.map((like) => {
        const videoUrls = normalizeVideoUrls(like);
        return {
          user_id,
          tiktok_video_id: like.tiktok_video_id,
          tiktok_url: like.tiktok_url ?? null,
          video_url: videoUrls[0] ?? null,
          video_urls: videoUrls,
          author_username: like.author_username ?? null,
          description: like.description ?? null,
          cover_url: like.cover_url ?? null,
        };
      });

      const { error: upsertError } = await supabase
        .from("user_likes")
        .upsert(rows, {
          onConflict: "user_id,tiktok_video_id",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        await supabase
          .from("profiles")
          .update({
            sync_status: "error",
            sync_error: upsertError.message,
          })
          .eq("id", user_id);

        return new Response(
          JSON.stringify({
            error: "Failed to upsert likes",
            detail: upsertError.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Mark profile as synced
    await supabase
      .from("profiles")
      .update({
        sync_status: "synced",
        sync_error: null,
        tiktok_username,
        synced_at: new Date().toISOString(),
      })
      .eq("id", user_id);

    return new Response(
      JSON.stringify({
        ok: true,
        synced_count: likes.length,
        tiktok_username,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
