// TikTok Data Portability API client (server-side only).
// Docs: https://developers.tiktok.com/doc/data-portability-api-get-started
// Flow: Login Kit OAuth -> add data request -> poll status -> download zip
// -> extract Like List -> upsert into user_likes.

import { unzipSync, strFromU8 } from "fflate";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const ADD_REQUEST_URL =
  "https://open.tiktokapis.com/v2/user/data/add/?fields=request_id";
const CHECK_REQUEST_URL =
  "https://open.tiktokapis.com/v2/user/data/check/?fields=request_id,status,apply_time,collect_time";
const DOWNLOAD_URL = "https://open.tiktokapis.com/v2/user/data/download/";

export function isPortabilityEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_TIKTOK_PORTABILITY_ENABLED === "true" &&
    Boolean(process.env.TIKTOK_CLIENT_KEY) &&
    Boolean(process.env.TIKTOK_CLIENT_SECRET)
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_key: requiredEnv("TIKTOK_CLIENT_KEY"),
    response_type: "code",
    scope: process.env.TIKTOK_PORTABILITY_SCOPE || "portability.all.single",
    redirect_uri: requiredEnv("TIKTOK_REDIRECT_URI"),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TikTokTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
}

async function requestTokens(
  body: Record<string, string>,
): Promise<TikTokTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const data = (await response.json().catch(() => ({}))) as TikTokTokens & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "TikTok token request failed",
    );
  }

  return data;
}

export function exchangeCode(code: string): Promise<TikTokTokens> {
  return requestTokens({
    client_key: requiredEnv("TIKTOK_CLIENT_KEY"),
    client_secret: requiredEnv("TIKTOK_CLIENT_SECRET"),
    code,
    grant_type: "authorization_code",
    redirect_uri: requiredEnv("TIKTOK_REDIRECT_URI"),
  });
}

export function refreshTokens(refreshToken: string): Promise<TikTokTokens> {
  return requestTokens({
    client_key: requiredEnv("TIKTOK_CLIENT_KEY"),
    client_secret: requiredEnv("TIKTOK_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

interface PortabilityError {
  code?: string;
  message?: string;
}

export async function addDataRequest(accessToken: string): Promise<number> {
  const response = await fetch(ADD_REQUEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data_format: "json",
      category_selection_list: ["all_data"],
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: { request_id?: number };
    error?: PortabilityError;
  };

  if (!response.ok || !data.data?.request_id) {
    throw new Error(data.error?.message || "Failed to add TikTok data request");
  }

  return data.data.request_id;
}

export type DataRequestStatus =
  | "pending"
  | "downloading"
  | "expired"
  | "cancelled";

export async function checkDataRequest(
  accessToken: string,
  requestId: number,
): Promise<DataRequestStatus> {
  const response = await fetch(CHECK_REQUEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_id: requestId }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: { status?: string };
    error?: PortabilityError;
  };

  if (!response.ok || !data.data?.status) {
    throw new Error(
      data.error?.message || "Failed to check TikTok data request",
    );
  }

  return data.data.status as DataRequestStatus;
}

export async function downloadDataArchive(
  accessToken: string,
  requestId: number,
): Promise<Uint8Array> {
  const response = await fetch(DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_id: requestId }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: PortabilityError;
    };
    throw new Error(
      data.error?.message || "Failed to download TikTok data archive",
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

export interface PortabilityLike {
  tiktok_video_id: string;
  tiktok_url: string;
  liked_at: string | null;
}

/**
 * Walk arbitrary export JSON and collect entries that live under a
 * "Like"-named key and carry a TikTok video link. Tolerant to the export's
 * varying casing and nesting (Activity -> Like List -> ItemFavoriteList).
 */
export function extractLikesFromJson(root: unknown): PortabilityLike[] {
  const likes: PortabilityLike[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, underLikeKey: boolean) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, underLikeKey);
      return;
    }
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;

    if (underLikeKey) {
      const link = [record.Link, record.link, record.VideoLink].find(
        (value): value is string => typeof value === "string",
      );
      const date = [record.Date, record.date].find(
        (value): value is string => typeof value === "string",
      );

      if (link) {
        const match = link.match(/video\/(\d+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          likes.push({
            tiktok_video_id: match[1],
            tiktok_url: link,
            liked_at: date ?? null,
          });
        }
      }
    }

    for (const [key, value] of Object.entries(record)) {
      visit(value, underLikeKey || /like/i.test(key));
    }
  };

  visit(root, false);
  return likes;
}

export function extractLikesFromArchive(zipBytes: Uint8Array): PortabilityLike[] {
  const files = unzipSync(zipBytes);
  const likes: PortabilityLike[] = [];
  const seen = new Set<string>();

  for (const [name, contents] of Object.entries(files)) {
    if (!/\.json$/i.test(name)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(contents));
    } catch {
      continue;
    }

    for (const like of extractLikesFromJson(parsed)) {
      if (seen.has(like.tiktok_video_id)) continue;
      seen.add(like.tiktok_video_id);
      likes.push(like);
    }
  }

  return likes;
}
