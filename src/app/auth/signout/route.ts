import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n";

/**
 * POST /auth/signout
 * Signs the user out and redirects to home.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/${defaultLocale}`, {
    status: 302,
  });
}
