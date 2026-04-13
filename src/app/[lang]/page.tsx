import Link from "next/link";
import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getUser, getProfile } from "@/lib/auth";
import { exchangeCodeForSession } from "@/lib/supabase/oauth";
import { RejoinBanner } from "@/components/rejoin-banner";
import { GoogleSignInButton } from "@/components/google-sign-in";
import { UserMenu } from "@/components/user-menu";

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isValidLocale(lang)) notFound();

  if (query.code) {
    const { error, onboardingCompleted } = await exchangeCodeForSession(query.code);

    if (error) {
      redirect(`/${lang}?error=auth`);
    }

    if (!onboardingCompleted) {
      redirect(`/${lang}/onboarding`);
    }

    redirect(`/${lang}`);
  }

  const dict = await getDictionary(lang);

  const user = await getUser();
  const profile = user ? await getProfile() : null;

  // If logged in but onboarding not done, redirect to onboarding
  if (user && profile && !profile.onboarding_completed) {
    redirect(`/${lang}/onboarding`);
  }

  const isLoggedIn = !!user && !!profile?.onboarding_completed;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      {/* User menu (top right) — only for logged-in users */}
      {isLoggedIn && profile && (
        <UserMenu profile={profile} dict={dict} />
      )}

      {/* Logo / Title */}
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight text-accent">
          {dict.app.title}
        </h1>
        <p className="mt-3 text-lg text-muted">
          {isLoggedIn ? dict.home.subtitle : dict.app.description}
        </p>
      </div>

      {isLoggedIn ? (
        <>
          {/* Non-blocking rejoin banner */}
          <RejoinBanner lang={lang} dict={dict} />

          {/* Authenticated actions */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <Link
              href={`/${lang}/create`}
              className="flex items-center justify-center w-full h-14 rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95"
            >
              {dict.home.createRoom}
            </Link>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-surface-2" />
              <span className="text-muted text-sm">{dict.home.or}</span>
              <div className="flex-1 h-px bg-surface-2" />
            </div>

            <Link
              href={`/${lang}/join`}
              className="flex items-center justify-center w-full h-14 rounded-2xl bg-surface border border-surface-2 text-foreground font-bold text-lg transition-transform active:scale-95"
            >
              {dict.home.joinRoom}
            </Link>
          </div>
        </>
      ) : (
        <>
          {/* Unauthenticated — Google sign-in */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            {query.error === "auth" && (
              <p className="text-center text-sm text-red-400">
                {dict.auth?.error ?? "Sign-in failed. Please try again."}
              </p>
            )}
            <GoogleSignInButton
              label={dict.auth?.signInWithGoogle ?? "Sign in with Google"}
            />
          </div>
        </>
      )}

      {/* Language switcher */}
      <div className="flex gap-3 text-sm text-muted">
        <Link
          href="/en"
          className={lang === "en" ? "text-foreground font-semibold" : ""}
        >
          English
        </Link>
        <span>/</span>
        <Link
          href="/pl"
          className={lang === "pl" ? "text-foreground font-semibold" : ""}
        >
          Polski
        </Link>
      </div>
    </main>
  );
}
