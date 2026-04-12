import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { ResultsView } from "@/components/results-view";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ lang: string; pin: string }>;
}) {
  const { lang, pin } = await params;
  if (!isValidLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <ResultsView lang={lang} pin={pin} dict={dict} />;
}
