import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { getProfile, getUser } from "@/lib/auth";
import { SoloView } from "@/components/solo-view";
import { notFound, redirect } from "next/navigation";

export default async function SoloPage({
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

  return <SoloView dict={dict} />;
}
