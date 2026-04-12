import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { ScoreboardView } from "@/components/scoreboard-view";

export default async function ScoresPage({
  params,
}: {
  params: Promise<{ lang: string; pin: string }>;
}) {
  const { lang, pin } = await params;
  if (!isValidLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <ScoreboardView lang={lang} pin={pin} dict={dict} />;
}
