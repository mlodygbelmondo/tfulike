import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Get the currently authenticated user, or null if not logged in.
 * Server-side only (uses cookies).
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the profile for the current user.
 * Returns null if not authenticated or profile doesn't exist yet.
 */
export async function getProfile(): Promise<Profile | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}

/**
 * Require authentication. Throws redirect-compatible info if not logged in.
 * For use in Server Components and Route Handlers.
 */
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

/**
 * Require a completed profile (user has finished onboarding).
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) {
    throw new Error("UNAUTHORIZED");
  }
  if (!profile.onboarding_completed) {
    throw new Error("ONBOARDING_REQUIRED");
  }
  return profile;
}
