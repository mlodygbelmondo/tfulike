// Extension bridge: communicates with the tfulike Chrome extension via window.postMessage

export interface ExtensionSyncRequest {
  user_id?: string;
}

export interface ExtensionSyncResponse {
  ok: boolean;
  tiktok_username?: string;
  likes?: Array<{
    tiktok_video_id: string;
    tiktok_url?: string;
    media_type?: "video" | "photo_gallery";
    video_url?: string;
    video_urls?: string[];
    image_urls?: string[];
    audio_url?: string;
    author_username?: string;
    description?: string;
    cover_url?: string;
  }>;
  error?: string;
}

export interface VideoRefreshRequest {
  tiktok_video_id: string;
  tiktok_url?: string | null;
  author_username?: string | null;
}

export interface VideoRefreshResponse {
  ok: boolean;
  video_url?: string;
  video_urls?: string[];
  error?: string;
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface VideoDataResponse {
  ok: boolean;
  base64?: string;
  content_type?: string;
  error?: string;
}

function createBlobUrlFromBase64(base64: string, contentType: string): string {
  const binary = window.atob(base64);
  const chunkSize = 0x8000;
  const chunks: ArrayBuffer[] = [];

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);

    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }

    chunks.push(bytes.buffer.slice(0));
  }

  return URL.createObjectURL(new Blob(chunks, { type: contentType }));
}

/**
 * Check if the tfulike Chrome extension is installed.
 * Returns the extension version string, or null if not present.
 */
export function checkExtensionPresent(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(null);
    }, 1500);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.type === "TAPUJEMY_EXTENSION_PRESENT") {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve(event.data.payload?.version || "unknown");
      }
    }

    window.addEventListener("message", handler);
    window.postMessage({ type: "TAPUJEMY_EXTENSION_CHECK" }, "*");
  });
}

/**
 * Request the extension to scrape TikTok likes for the authenticated user.
 * Returns scraped TikTok data; the page persists it via Supabase.
 */
export function requestExtensionSync(
  request: ExtensionSyncRequest
): Promise<ExtensionSyncResponse> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ ok: false, error: "Not in browser" });
      return;
    }

    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve({ ok: false, error: "Extension did not respond (timeout)" });
    }, 60_000); // 60s timeout for TikTok API pagination

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.type === "TAPUJEMY_SYNC_RESPONSE") {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve(event.data.payload || { ok: false, error: "Empty response" });
      }
    }

    window.addEventListener("message", handler);
    window.postMessage(
      {
        type: "TAPUJEMY_SYNC_REQUEST",
        payload: request,
      },
      "*"
    );
  });
}

/**
 * Request the extension to refresh a single video's CDN URLs from TikTok.
 * The extension scrapes fresh PlayAddr URLs via the open TikTok tab's session.
 * Returns fresh video_url + video_urls on success.
 */
export function requestVideoRefresh(
  request: VideoRefreshRequest
): Promise<VideoRefreshResponse> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ ok: false, error: "Not in browser" });
      return;
    }

    const requestId = createRequestId();

    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve({ ok: false, error: "Extension did not respond (timeout)" });
    }, 15_000); // 15s timeout for single video refresh

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      if (
        event.data?.type === "TAPUJEMY_VIDEO_REFRESH_RESPONSE" &&
        event.data?.requestId === requestId
      ) {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve(event.data.payload || { ok: false, error: "Empty response" });
      }
    }

    window.addEventListener("message", handler);
    window.postMessage(
      {
        type: "TAPUJEMY_VIDEO_REFRESH_REQUEST",
        requestId,
        payload: request,
      },
      "*"
    );
  });
}

function requestBinaryMediaBlob(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in browser"));
      return;
    }

    const requestId = createRequestId();

    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Extension did not respond (timeout)"));
    }, 60_000);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      if (
        event.data?.type === "TAPUJEMY_VIDEO_DATA_RESPONSE" &&
        event.data?.requestId === requestId
      ) {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);

        const payload = event.data.payload as VideoDataResponse | undefined;
        if (payload?.ok && payload.base64) {
          resolve(
            createBlobUrlFromBase64(payload.base64, payload.content_type || "video/mp4")
          );
          return;
        }

        reject(new Error(payload?.error || "Empty response from extension"));
      }
    }

    window.addEventListener("message", handler);
    window.postMessage(
      {
        type: "TAPUJEMY_FETCH_VIDEO_DATA",
        requestId,
        payload: { url },
      },
      "*"
    );
  });
}

/**
 * Request the extension to fetch a raw video URL on the client's network stack
 * and return a Blob URL that the page can play without direct TikTok requests.
 */
export function requestVideoDataUri(url: string): Promise<string> {
  return requestBinaryMediaBlob(url);
}

/**
 * Request the extension to fetch any binary media URL and return a Blob URL.
 * Used for photo-gallery audio tracks and other non-video media assets.
 */
export function requestMediaDataUri(url: string): Promise<string> {
  return requestBinaryMediaBlob(url);
}
