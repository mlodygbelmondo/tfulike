import Link from "next/link";
import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { JoinRoomForm } from "@/components/join-room-form";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isValidLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <main className="flex flex-col items-center min-h-screen p-6">
      {/* Back */}
      <div className="w-full max-w-xs mb-6">
        <Link
          href={`/${lang}`}
          className="text-muted text-sm flex items-center gap-1"
        >
          &larr; Back
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-8">{dict.join.title}</h1>

      <div className="w-full max-w-xs">
        <JoinRoomForm lang={lang} dict={dict} />
      </div>
    </main>
  );
}
