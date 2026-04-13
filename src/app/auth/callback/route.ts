import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n";

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
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if the user has completed onboarding
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .single();

        if (!profile?.onboarding_completed) {
          return NextResponse.redirect(`${origin}/${lang}/onboarding`);
        }
      }

      return NextResponse.redirect(`${origin}/${lang}`);
    }
  }

  // Auth error — redirect to home
  return NextResponse.redirect(`${origin}/${lang}?error=auth`);
}
