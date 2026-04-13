import Link from "next/link";
import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound, redirect } from "next/navigation";
import { CreateRoomForm } from "@/components/create-room-form";
import { getUser, getProfile } from "@/lib/auth";

export default async function CreatePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isValidLocale(lang)) notFound();

  const user = await getUser();
  if (!user) redirect(`/${lang}`);

  const profile = await getProfile();
  if (!profile?.onboarding_completed) redirect(`/${lang}/onboarding`);

  const dict = await getDictionary(lang);

  return (
    <main className="flex min-h-screen flex-col p-6">
      {/* Back */}
      <div className="mb-6 w-full">
        <Link
          href={`/${lang}`}
          className="text-muted text-sm flex items-center gap-1"
        >
          &larr; Back
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-8">{dict.create.title}</h1>

      <div className="flex w-full flex-1 flex-col">
        <CreateRoomForm lang={lang} dict={dict} profile={profile} />
      </div>
    </main>
  );
}
