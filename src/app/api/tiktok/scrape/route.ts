import { NextResponse } from "next/server";

/**
 * POST /api/tiktok/scrape
 *
 * DEPRECATED: This route previously scraped TikTok liked videos on the server.
 * With the Chrome Extension pipeline, TikTok data is fetched directly by the
 * extension using the player's TikTok session cookies and sent to the
 * Supabase Edge Function (sync-likes).
 *
 * This route is kept as a stub to avoid 404s from any remaining references.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. TikTok likes are now synced via the Chrome Extension.",
    },
    { status: 410 }
  );
}
