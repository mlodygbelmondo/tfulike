import { NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n";
import { exchangeCodeForSession } from "@/lib/supabase/oauth";

/**
 * GET /auth/callback
 *
 * Supabase redirects here after Google OAuth consent.
 * We exchange the `code` for a session, then redirect:
 *   - New user (no onboarding) → /[lang]/onboarding
 *   - Returning user → /[lang]
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const lang = defaultLocale; // TODO: persist pre-login locale in cookie

  if (code) {
    const { error, onboardingCompleted } = await exchangeCodeForSession(code);

    if (!error) {
      if (!onboardingCompleted) {
        return NextResponse.redirect(`${origin}/${lang}/onboarding`);
      }

      return NextResponse.redirect(`${origin}/${lang}`);
    }
  }

  // Auth error — redirect to home
  return NextResponse.redirect(`${origin}/${lang}?error=auth`);
}
