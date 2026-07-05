import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthorizeUrl,
  isPortabilityEnabled,
} from "@/lib/tiktok-portability";

const STATE_COOKIE = "tiktok_oauth_state";

export async function GET(request: Request) {
  if (!isPortabilityEnabled()) {
    return NextResponse.json(
      { error: "TikTok portability is not enabled" },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildAuthorizeUrl(state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 600,
    path: "/",
  });

  return response;
}
