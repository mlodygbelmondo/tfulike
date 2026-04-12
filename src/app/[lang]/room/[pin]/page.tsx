import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { LobbyView } from "@/components/lobby-view";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ lang: string; pin: string }>;
}) {
  const { lang, pin } = await params;
  if (!isValidLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <LobbyView lang={lang} pin={pin} dict={dict} />;
}
