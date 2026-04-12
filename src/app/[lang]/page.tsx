import Link from "next/link";
import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { RejoinBanner } from "@/components/rejoin-banner";
import { ProfileSetup } from "@/components/profile-setup";

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ profile?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isValidLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const editProfile = query.profile === "edit";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <ProfileSetup dict={dict} forceOpen={editProfile} />

      <Link
        href={`/${lang}?profile=edit`}
        className="absolute right-6 top-6 inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-surface-2 px-3 text-sm leading-none text-muted transition-colors hover:text-foreground"
      >
        {dict.home.editProfile}
      </Link>

      {/* Logo / Title */}
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight text-accent">
          {dict.app.title}
        </h1>
        <p className="mt-3 text-lg text-muted">{dict.home.subtitle}</p>
      </div>

      {/* Non-blocking rejoin banner */}
      <RejoinBanner lang={lang} dict={dict} />

      {/* Actions */}
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
