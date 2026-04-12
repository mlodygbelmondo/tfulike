// supabase/functions/sync-likes/index.ts
// Edge Function: receives parsed TikTok likes from the Chrome Extension
// and upserts them into the `likes` table, updating player sync_status.

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
  player_id: string;
  room_id: string;
  likes: LikePayload[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
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

    const body: SyncRequest = await req.json();
    const { player_id, room_id, likes } = body;

    // --- Validate required fields ---
    if (!player_id || !room_id || !Array.isArray(likes)) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: player_id, room_id, likes[]",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Verify player exists and belongs to room ---
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("id, room_id")
      .eq("id", player_id)
      .eq("room_id", room_id)
      .single();

    if (playerError || !player) {
      return new Response(
        JSON.stringify({ error: "Player not found in this room" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Mark player as syncing ---
    await supabase
      .from("players")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", player_id);

    // --- Upsert likes ---
    if (likes.length > 0) {
      const rows = likes.map((like) => {
        const videoUrls = normalizeVideoUrls(like);
        return {
          player_id,
          room_id,
          tiktok_video_id: like.tiktok_video_id,
          tiktok_url: like.tiktok_url ?? null,
          video_url: videoUrls[0] ?? null,
          video_urls: videoUrls,
          author_username: like.author_username ?? null,
          description: like.description ?? null,
          cover_url: like.cover_url ?? null,
        };
      });

      const { error: upsertError } = await supabase.from("likes").upsert(rows, {
        onConflict: "player_id,room_id,tiktok_video_id",
        ignoreDuplicates: false,
      });

      if (upsertError) {
        // Mark sync as failed
        await supabase
          .from("players")
          .update({
            sync_status: "error",
            sync_error: upsertError.message,
          })
          .eq("id", player_id);

        return new Response(
          JSON.stringify({ error: "Failed to upsert likes", detail: upsertError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // --- Mark player as synced ---
    await supabase
      .from("players")
      .update({
        sync_status: "synced",
        sync_error: null,
        synced_at: new Date().toISOString(),
        videos_ready: true,
      })
      .eq("id", player_id);

    return new Response(
      JSON.stringify({
        ok: true,
        synced_count: likes.length,
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
