// extension/background.js
// Background service worker: coordinates TikTok sync from an open desktop TikTok tab
// and forwards parsed liked videos to the Supabase Edge Function.

import { chooseTikTokTab } from "./tiktok-tab.js";

function logDebug(step, details = {}) {
  console.log("[tfulike-sync]", step, details);
}

// Ensure declarativeNetRequest rules are active after install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  logDebug("extension-installed", { reason: details.reason });

  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    logDebug("declarativeNetRequest-rules", {
      dynamicCount: rules.length,
      reason: details.reason,
    });
  } catch (err) {
    logDebug("declarativeNetRequest-check-error", { error: String(err) });
  }
});

function summarizeVideoUrl(urlString) {
  if (typeof urlString !== "string" || !urlString) {
    return null;
  }

  try {
    const url = new URL(urlString);
    const expire = url.searchParams.get("expire");
    const expireAt = expire ? Number(expire) : null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const queryKeys = Array.from(new Set(url.searchParams.keys()))
      .filter((key) => !["signature", "tk", "l", "X-Bogus"].includes(key))
      .sort();

    return {
      host: url.host,
      pathTail: url.pathname.split("/").slice(-4).join("/"),
      expireAt,
      expiresInSec:
        typeof expireAt === "number" && Number.isFinite(expireAt)
          ? expireAt - nowSeconds
          : null,
      hasSignature: url.searchParams.has("signature"),
      hasTk: url.searchParams.has("tk"),
      queryKeyCount: queryKeys.length,
      queryKeysPreview: queryKeys.slice(0, 8),
    };
  } catch {
    return { invalid: true };
  }
}

function summarizeLikeForDebug(like) {
  return {
    tiktok_video_id: like?.tiktok_video_id || null,
    author_username: like?.author_username || null,
    candidateCount: Array.isArray(like?.video_urls) ? like.video_urls.length : 0,
    primaryUrl: summarizeVideoUrl(like?.video_url),
    candidatePreview: Array.isArray(like?.video_urls)
      ? like.video_urls.slice(0, 3).map((url) => summarizeVideoUrl(url))
      : [],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_LIKES") {
    handleSyncLikes(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err.message || err) })
      );
    return true;
  }

  if (message.type === "VIDEO_REFRESH") {
    handleVideoRefresh(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err.message || err) })
      );
    return true;
  }

  if (message.type === "FETCH_VIDEO_DATA") {
    handleFetchVideoData(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err.message || err) })
      );
    return true;
  }
});

async function handleFetchVideoData(payload) {
  const url = payload?.url;

  if (typeof url !== "string" || !url.trim()) {
    return { ok: false, error: "Missing video URL" };
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(url);
  } catch {
    return { ok: false, error: "Invalid video URL" };
  }

  if (normalizedUrl.protocol !== "https:") {
    return { ok: false, error: "Only HTTPS video URLs are supported" };
  }

  logDebug("video-data-fetch-start", {
    host: normalizedUrl.host,
    path: normalizedUrl.pathname,
  });

  const response = await fetch(normalizedUrl.toString(), {
    headers: {
      Referer: "https://www.tiktok.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    logDebug("video-data-fetch-failed", {
      status: response.status,
      host: normalizedUrl.host,
    });
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "video/mp4";
  const bytes = new Uint8Array(buffer);
  const byteLength = bytes.byteLength;

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, byteLength));
    binary += String.fromCharCode(...chunk);
  }

  const base64 = btoa(binary);

  logDebug("video-data-fetch-success", {
    host: normalizedUrl.host,
    bytes: byteLength,
    mimeType,
  });

  return {
    ok: true,
    base64,
    content_type: mimeType,
  };
}

async function handleSyncLikes(payload) {
  const { player_id, room_id, tiktok_username, sync_function_url } = payload;

  if (!player_id || !room_id || !sync_function_url) {
    return { ok: false, error: "Missing required fields in sync request" };
  }

  try {
    const likes = await fetchTikTokLikes(tiktok_username);

    logDebug("sync-likes-ready", {
      roomId: room_id,
      playerId: player_id,
      likeCount: likes.length,
      preview: likes.slice(0, 3).map((like) => summarizeLikeForDebug(like)),
    });

    if (!likes || likes.length === 0) {
      return {
        ok: false,
        error:
          "No liked videos found in your open TikTok tab. Make sure TikTok is open on desktop Chrome, you are logged in, and the account matches your profile.",
      };
    }

    const response = await fetch(sync_function_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        player_id,
        room_id,
        likes,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      logDebug("sync-function-error", {
        status: response.status,
        error: errBody.error || null,
      });
      return {
        ok: false,
        error: errBody.error || `Edge function returned ${response.status}`,
      };
    }

    const result = await response.json().catch(() => ({ synced_count: likes.length }));
    logDebug("sync-function-success", {
      syncedCount: result.synced_count ?? likes.length,
    });
    return { ok: true, synced_count: result.synced_count ?? likes.length };
  } catch (err) {
    logDebug("sync-likes-failed", {
      error: String(err.message || err),
    });
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Handle a video URL refresh request from the web app.
 * Re-scrapes a single video's PlayAddr from TikTok using the open tab's session.
 * Payload: { tiktok_video_id, tiktok_url, author_username }
 * Returns: { ok, video_urls, video_url } with fresh CDN URLs.
 */
async function handleVideoRefresh(payload) {
  const { tiktok_video_id, tiktok_url, author_username } = payload || {};

  if (!tiktok_video_id) {
    return { ok: false, error: "Missing tiktok_video_id for refresh" };
  }

  logDebug("video-refresh-start", { tiktok_video_id, tiktok_url, author_username });

  try {
    const tab = await getTikTokTab();
    if (!tab?.id) {
      return {
        ok: false,
        error: "No open TikTok tab. Open TikTok in desktop Chrome and try again.",
      };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: refreshSingleVideoInPage,
      args: [tiktok_video_id],
    });

    const result = results?.[0]?.result;
    logDebug("video-refresh-result", {
      tiktok_video_id,
      ok: result?.ok === true,
      urlCount: Array.isArray(result?.video_urls) ? result.video_urls.length : 0,
      error: result?.error || null,
    });

    if (!result) {
      return { ok: false, error: "TikTok tab did not return refresh data." };
    }

    return result;
  } catch (err) {
    logDebug("video-refresh-failed", { tiktok_video_id, error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Injected into TikTok tab (MAIN world) to fetch a single video's details
 * and extract fresh PlayAddr URLs.
 */
async function refreshSingleVideoInPage(videoId) {
  try {
    const msTokenMatch = document.cookie.match(/(?:^|; )msToken=([^;]*)/);
    const msToken = msTokenMatch ? decodeURIComponent(msTokenMatch[1]) : null;

    // Try the detail endpoint for a single video
    const detailUrl = new URL("/api/item/detail/", "https://www.tiktok.com");
    detailUrl.searchParams.set("itemId", videoId);
    if (msToken) detailUrl.searchParams.set("msToken", msToken);

    let signature = null;
    const signer = window.byted_acrawler?.frontierSign;
    if (typeof signer === "function") {
      try {
        const sigResult = await signer(detailUrl.toString());
        signature = sigResult?.["X-Bogus"] || sigResult?.XBogus || null;
      } catch {
        // proceed without signature
      }
    }

    let fetchUrl = detailUrl.toString();
    if (signature) {
      fetchUrl += `&X-Bogus=${encodeURIComponent(signature)}`;
    }

    const response = await fetch(fetchUrl, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        Referer: window.location.href,
      },
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text.trim());
    } catch {
      return {
        ok: false,
        error: `TikTok returned invalid JSON for video detail (status ${response.status})`,
      };
    }

    const item = data?.itemInfo?.itemStruct || data?.item || null;
    if (!item || !item.video) {
      return {
        ok: false,
        error: `Could not find video data in TikTok response (status ${response.status}, statusCode ${data?.statusCode})`,
      };
    }

    // Extract fresh URLs from bitrateInfo + playAddr + downloadAddr
    const videoUrls = [];
    const pushUrl = (url) => {
      if (typeof url !== "string") return;
      const normalized = url.trim();
      if (!normalized || !/^https?:\/\//i.test(normalized)) return;
      if (!videoUrls.includes(normalized)) {
        videoUrls.push(normalized);
      }
    };

    if (Array.isArray(item.video.bitrateInfo)) {
      for (const bitrate of item.video.bitrateInfo) {
        if (Array.isArray(bitrate?.PlayAddr?.UrlList)) {
          for (const url of bitrate.PlayAddr.UrlList) {
            pushUrl(url);
          }
        }
      }
    }

    pushUrl(item.video?.playAddr);
    pushUrl(item.video?.downloadAddr);

    if (videoUrls.length === 0) {
      return {
        ok: false,
        error: "Video found but no playable URLs extracted",
      };
    }

    return {
      ok: true,
      video_url: videoUrls[0],
      video_urls: videoUrls,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
    };
  }
}

async function fetchTikTokLikes(tiktokUsername) {
  logDebug("fetch-start", { tiktokUsername });

  const tab = await getTikTokTab();
  if (!tab?.id) {
    throw new Error(
      "Open TikTok in this desktop Chrome browser, stay logged in, and try sync again. Mobile PWA sync is not supported."
    );
  }

  logDebug("using-tab", { tabId: tab.id, url: tab.url });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: scrapeTikTokLikesInPage,
    args: [tiktokUsername],
  });

  const payload = results?.[0]?.result;
  logDebug("script-result", {
    ok: payload?.ok === true,
    likeCount: Array.isArray(payload?.likes) ? payload.likes.length : null,
    error: payload?.error || null,
  });

  if (!payload) {
    throw new Error("TikTok tab did not return any sync data.");
  }

  if (!payload.ok) {
    throw new Error(payload.error || "TikTok sync failed inside the TikTok tab.");
  }

  return payload.likes || [];
}

async function getTikTokTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://www.tiktok.com/*", "https://tiktok.com/*"],
  });
  return chooseTikTokTab(tabs);
}

async function scrapeTikTokLikesInPage(tiktokUsername) {
  function appendSignedUrl(url, signature) {
    if (!signature) {
      return url;
    }

    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}X-Bogus=${encodeURIComponent(signature)}`;
  }

  async function generateXBogus(url) {
    const signer = window.byted_acrawler?.frontierSign;
    if (typeof signer !== "function") {
      return null;
    }

    try {
      const result = await signer(url);
      return result?.["X-Bogus"] || result?.XBogus || null;
    } catch {
      return null;
    }
  }

  async function fetchTikTokJson(url, step) {
    const signature = await generateXBogus(url);
    const signedUrl = appendSignedUrl(url, signature);

    const response = await fetch(signedUrl, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        Referer: window.location.href,
      },
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "unknown";
    let data;

    try {
      data = parseJsonFromText(text, step, response.status);
    } catch (error) {
      throw new Error(
        `${String(error?.message || error)}; signed=${String(
          Boolean(signature)
        )}; contentType=${contentType}; textLength=${String(text.length)}`
      );
    }

    return {
      status: response.status,
      signed: Boolean(signature),
      contentType,
      textLength: text.length,
      data,
    };
  }

  function buildTikTokUrl(pathname, params) {
    const url = new URL(pathname, "https://www.tiktok.com");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  function buildUserDetailUrl(username, msToken) {
    return buildTikTokUrl("/api/user/detail/", {
      uniqueId: username,
      secUid: "",
      msToken,
    });
  }

  function buildLikedVideosUrl({ secUid, cursor, msToken }) {
    return buildTikTokUrl("/api/favorite/item_list/", {
      aid: 1988,
      app_language: navigator.language || "en",
      app_name: "tiktok_web",
      browser_language: navigator.language || "en-US",
      browser_name: "Mozilla",
      browser_online: navigator.onLine,
      browser_platform: navigator.platform || "MacIntel",
      browser_version: navigator.userAgent,
      channel: "tiktok_web",
      cookie_enabled: true,
      count: 30,
      coverFormat: 2,
      cursor,
      device_platform: "web_pc",
      focus_state: document.hasFocus(),
      from_page: "user",
      is_fullscreen: false,
      is_page_visible: document.visibilityState === "visible",
      language: navigator.language || "en",
      os: navigator.platform || "MacIntel",
      priority_region: "PL",
      region: "PL",
      screen_height: window.screen?.height || 1080,
      screen_width: window.screen?.width || 1920,
      tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Warsaw",
      user_is_login: true,
      secUid,
      msToken,
    });
  }

  function parseJsonFromText(text, step, status) {
    const trimmed = typeof text === "string" ? text.trim() : "";

    if (!trimmed) {
      throw new Error(`TikTok returned an empty response while loading ${step} (status ${status})`);
    }

    if (trimmed.startsWith("<")) {
      throw new Error(`TikTok returned HTML instead of JSON while loading ${step} (status ${status})`);
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`TikTok returned invalid JSON while loading ${step} (status ${status})`);
    }
  }

  function extractSecUid(data) {
    return data?.userInfo?.user?.secUid || data?.secUid || null;
  }

  function extractSecUidFromHtml(html) {
    if (typeof html !== "string" || !html) {
      return null;
    }

    const patterns = [
      /"secUid":"([^"]+)"/,
      /\\"secUid\\":\\"([^\\"]+)\\"/,
      /secUid\\u0022:\\u0022([^\\]+)\\u0022/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  async function fetchSecUidFromProfileHtml(username) {
    const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const response = await fetch(profileUrl, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: window.location.href,
      },
    });

    const html = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "unknown",
      textLength: html.length,
      secUid: extractSecUidFromHtml(html),
    };
  }

  function summarizeResponseShape(data) {
    return {
      keys: Object.keys(data || {}).sort(),
      hasItemList: Array.isArray(data?.itemList),
      itemListLength: Array.isArray(data?.itemList) ? data.itemList.length : null,
      hasMore: data?.hasMore ?? null,
      cursor: data?.cursor ?? null,
      statusCode: data?.statusCode ?? null,
      statusMsg: data?.statusMsg ?? null,
    };
  }

  function parseTikTokItem(item) {
    if (!item || !item.id) return null;

    const authorUsername = item.author?.uniqueId || item.author?.nickname || "";
    const videoId = String(item.id);
    const videoUrls = [];
    const pushUrl = (url) => {
      if (typeof url !== "string") return;
      const normalized = url.trim();
      if (!normalized || !/^https?:\/\//i.test(normalized)) return;
      if (!videoUrls.includes(normalized)) {
        videoUrls.push(normalized);
      }
    };

    if (Array.isArray(item.video?.bitrateInfo)) {
      for (const bitrate of item.video.bitrateInfo) {
        if (Array.isArray(bitrate?.PlayAddr?.UrlList)) {
          for (const url of bitrate.PlayAddr.UrlList) {
            pushUrl(url);
          }
        }
      }
    }

    pushUrl(item.video?.playAddr);
    pushUrl(item.video?.downloadAddr);

    return {
      tiktok_video_id: videoId,
      tiktok_url: `https://www.tiktok.com/@${authorUsername}/video/${videoId}`,
      video_url: videoUrls[0] || null,
      video_urls: videoUrls,
      author_username: authorUsername || null,
      description: item.desc || null,
      cover_url: item.video?.cover || item.video?.originCover || null,
    };
  }

  // Local copies of debug helpers (these must be inlined because this function
  // is serialized and injected into the TikTok tab -- outer-scope references
  // like background.js's summarizeLikeForDebug are NOT available at runtime).
  function _summarizeVideoUrl(urlString) {
    if (typeof urlString !== "string" || !urlString) return null;
    try {
      const u = new URL(urlString);
      const expire = u.searchParams.get("expire");
      const expireAt = expire ? Number(expire) : null;
      const nowSeconds = Math.floor(Date.now() / 1000);
      return {
        host: u.host,
        pathTail: u.pathname.split("/").slice(-4).join("/"),
        expireAt,
        expiresInSec:
          typeof expireAt === "number" && Number.isFinite(expireAt)
            ? expireAt - nowSeconds
            : null,
      };
    } catch {
      return { invalid: true };
    }
  }

  function _summarizeLikeForDebug(like) {
    return {
      tiktok_video_id: like?.tiktok_video_id || null,
      author_username: like?.author_username || null,
      candidateCount: Array.isArray(like?.video_urls) ? like.video_urls.length : 0,
      primaryUrl: _summarizeVideoUrl(like?.video_url),
      candidatePreview: Array.isArray(like?.video_urls)
        ? like.video_urls.slice(0, 3).map((url) => _summarizeVideoUrl(url))
        : [],
    };
  }

  try {
    const msTokenMatch = document.cookie.match(/(?:^|; )msToken=([^;]*)/);
    const msToken = msTokenMatch ? decodeURIComponent(msTokenMatch[1]) : null;

    let detailResult = null;
    let detailData = null;
    let detailError = null;
    let secUid = null;

    try {
      detailResult = await fetchTikTokJson(
        buildUserDetailUrl(tiktokUsername, msToken),
        "detail"
      );
      detailData = detailResult.data;
      secUid = extractSecUid(detailData);
    } catch (error) {
      detailError = String(error?.message || error);
    }

    let profileFallback = null;
    if (!secUid) {
      try {
        profileFallback = await fetchSecUidFromProfileHtml(tiktokUsername);
        secUid = profileFallback.secUid;
      } catch {
        profileFallback = null;
      }
    }

    if (!secUid) {
      return {
        ok: false,
        error:
          "Could not resolve this TikTok profile from the open TikTok tab. Double-check the username and stay logged in.",
        debug: {
          detailError,
          detail: detailData ? summarizeResponseShape(detailData) : null,
          detailSigned: detailResult?.signed ?? null,
          detailContentType: detailResult?.contentType ?? null,
          detailTextLength: detailResult?.textLength ?? null,
          fallbackStatus: profileFallback?.status ?? null,
          fallbackContentType: profileFallback?.contentType ?? null,
          fallbackTextLength: profileFallback?.textLength ?? null,
          fallbackFoundSecUid: Boolean(profileFallback?.secUid),
        },
      };
    }

    const likes = [];
    let cursor = 0;
    let hasMore = true;

    for (let page = 0; page < 10 && hasMore; page++) {
      const likesResult = await fetchTikTokJson(
        buildLikedVideosUrl({ secUid, cursor, msToken }),
        "likes"
      );
      const likesData = likesResult.data;

      console.log("[DEBUG][tfulike-sync]", "likes-page", {
        page,
        status: likesResult.status,
        signed: likesResult.signed,
        contentType: likesResult.contentType,
        textLength: likesResult.textLength,
        shape: summarizeResponseShape(likesData),
      });

      if (!Array.isArray(likesData.itemList) || likesData.itemList.length === 0) {
        break;
      }

      for (const item of likesData.itemList) {
        const like = parseTikTokItem(item);
        if (like) {
          likes.push(like);
        }
      }

      hasMore = likesData.hasMore === true;
      cursor = likesData.cursor || cursor + 30;
    }

    console.log("[DEBUG][tfulike-sync]", "likes-scrape-finished", {
      username: tiktokUsername,
      secUidResolved: Boolean(secUid),
      totalLikes: likes.length,
      preview: likes.slice(0, 3).map((like) => _summarizeLikeForDebug(like)),
    });

    return { ok: true, likes };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
    };
  }
}
