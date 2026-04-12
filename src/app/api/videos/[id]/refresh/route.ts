import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/videos/[id]/refresh
 *
 * This route used to refresh expired MP4 URLs.
 * With the Chrome Extension pipeline, video URLs come from the extension
 * and are stored in the likes/videos tables. This route now simply
 * returns the current video data without external API calls.
 *
 * If the URL is stale, the client should trigger a re-sync via the extension.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: video, error } = await supabase
      .from("videos")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Return the current video as-is — no server-side refresh available
    return NextResponse.json({ video });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
