import { getDictionary } from "@/lib/dictionaries";
import { isValidLocale } from "@/lib/i18n";
import { notFound, redirect } from "next/navigation";
import { getUser, getProfile } from "@/lib/auth";
import { OnboardingFlow } from "@/components/onboarding-flow";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isValidLocale(lang)) notFound();

  const user = await getUser();
  if (!user) {
    redirect(`/${lang}`);
  }

  const profile = await getProfile();

  // If onboarding already completed, go home
  if (profile?.onboarding_completed) {
    redirect(`/${lang}`);
  }

  const dict = await getDictionary(lang);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <OnboardingFlow
        lang={lang}
        dict={dict}
        initialProfile={
          profile
            ? {
                nickname: profile.nickname,
                color: profile.color,
                avatar_url: profile.avatar_url,
                tiktok_username: profile.tiktok_username,
                sync_status: profile.sync_status,
              }
            : null
        }
      />
    </main>
  );
}
