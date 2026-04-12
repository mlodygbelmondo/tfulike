import { type NextRequest, NextResponse } from "next/server";
import Negotiator from "negotiator";
import { match } from "@formatjs/intl-localematcher";
import { locales, defaultLocale } from "@/lib/i18n";

function getLocale(request: NextRequest): string {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const negotiated = new Negotiator({ headers }).languages();
  const safeLanguages = negotiated
    .map((lang) => lang.trim())
    .filter((lang) => lang.length > 0 && lang !== "*")
    .filter((lang) => {
      try {
        Intl.getCanonicalLocales(lang);
        return true;
      } catch {
        return false;
      }
    });

  try {
    return match(safeLanguages, [...locales], defaultLocale);
  } catch {
    return defaultLocale;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Some browsers/extensions may request a locale-scoped manifest path.
  // Normalize it to the root metadata route.
  const isLocalizedManifest = locales.some(
    (locale) => pathname === `/${locale}/manifest.webmanifest`
  );

  if (isLocalizedManifest) {
    const url = request.nextUrl.clone();
    url.pathname = "/manifest.webmanifest";
    return NextResponse.redirect(url);
  }

  // Check if pathname already has a locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameHasLocale) return NextResponse.next();

  // Redirect to locale-prefixed path
  const locale = getLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: [
    "/((?!_next|api|favicon.ico|manifest.json|manifest.webmanifest|sw.js|icons).*)",
  ],
};
