import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/profile
 *
 * Update the authenticated user's profile.
 * Accepts partial updates: { nickname?, color?, tiktok_username?, sync_status? }
 */
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
    const updates: Record<string, unknown> = {};

    if (typeof body.nickname === "string" && body.nickname.trim()) {
      updates.nickname = body.nickname.trim().slice(0, 20);
    }
    if (typeof body.color === "string" && body.color) {
      updates.color = body.color;
    }
    if (typeof body.tiktok_username === "string") {
      updates.tiktok_username = body.tiktok_username || null;
    }
    if (
      typeof body.sync_status === "string" &&
      ["idle", "syncing", "synced", "error"].includes(body.sync_status)
    ) {
      updates.sync_status = body.sync_status;
      if (body.sync_status === "synced") {
        updates.synced_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const playerUpdates: Record<string, unknown> = {};
    if ("nickname" in updates) playerUpdates.nickname = updates.nickname;
    if ("color" in updates) playerUpdates.color = updates.color;
    if ("tiktok_username" in updates) playerUpdates.tiktok_username = updates.tiktok_username;
    if ("sync_status" in updates) playerUpdates.sync_status = updates.sync_status;
    if ("synced_at" in updates) playerUpdates.synced_at = updates.synced_at;

    if (Object.keys(playerUpdates).length > 0) {
      await adminSupabase
        .from("players")
        .update(playerUpdates)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ profile: data });
  } catch (err) {
    console.error("Profile update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
