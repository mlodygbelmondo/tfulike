import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCode,
  isPortabilityEnabled,
} from "@/lib/tiktok-portability";

const STATE_COOKIE = "tiktok_oauth_state";

function redirectHome(request: Request, query: string) {
  const url = new URL(`/?${query}`, request.url);
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: Request) {
  if (!isPortabilityEnabled()) {
    return NextResponse.json(
      { error: "TikTok portability is not enabled" },
      { status: 404 },
    );
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error");

  if (oauthError || !code) {
    return redirectHome(request, "tiktok=denied");
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const stateCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!state || !stateCookie || state !== stateCookie) {
    return redirectHome(request, "tiktok=state_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectHome(request, "tiktok=unauthorized");
  }

  try {
    const tokens = await exchangeCode(code);
    const now = Date.now();
    const adminSupabase = createAdminClient();

    const { error } = await adminSupabase.from("tiktok_connections").upsert(
      {
        user_id: user.id,
        open_id: tokens.open_id ?? null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        access_token_expires_at: new Date(
          now + tokens.expires_in * 1000,
        ).toISOString(),
        refresh_token_expires_at: tokens.refresh_expires_in
          ? new Date(now + tokens.refresh_expires_in * 1000).toISOString()
          : null,
        scope: tokens.scope ?? null,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      return redirectHome(request, "tiktok=error");
    }

    return redirectHome(request, "tiktok=connected");
  } catch {
    return redirectHome(request, "tiktok=error");
  }
}
