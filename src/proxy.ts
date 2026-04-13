import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { locales, defaultLocale, type Locale } from "@/lib/i18n";
import { match as matchLocale } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

function getPreferredLocale(request: NextRequest): Locale {
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const languages = new Negotiator({ headers }).languages();
  try {
    return matchLocale(languages, locales, defaultLocale) as Locale;
  } catch {
    return defaultLocale;
  }
}

const PUBLIC_FILE_RE = /\.(.*)$/;
const IGNORED_PREFIXES = ["/_next", "/api", "/auth", "/manifest", "/sw.js"];

function shouldSkip(pathname: string) {
  if (PUBLIC_FILE_RE.test(pathname)) return true;
  return IGNORED_PREFIXES.some((p) => pathname.startsWith(p));
}

function getPathnameLocale(pathname: string): Locale | null {
  const seg = pathname.split("/")[1];
  return locales.includes(seg as Locale) ? (seg as Locale) : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/solo") {
    const locale = getPreferredLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/solo`;
    return NextResponse.redirect(url);
  }

  const isLocalizedManifest = locales.some(
    (locale) => pathname === `/${locale}/manifest.webmanifest`
  );
  if (isLocalizedManifest) {
    const url = request.nextUrl.clone();
    url.pathname = "/manifest.webmanifest";
    return NextResponse.redirect(url);
  }

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  const pathnameLocale = getPathnameLocale(pathname);
  if (!pathnameLocale) {
    const locale = getPreferredLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname}`;
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathAfterLocale = pathname.replace(`/${pathnameLocale}`, "") || "/";
  const isHome = pathAfterLocale === "/" || pathAfterLocale === "";

  if (!user && !isHome) {
    const url = request.nextUrl.clone();
    url.pathname = `/${pathnameLocale}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
