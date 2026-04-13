const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function buildTikTokUrl(pathname, params) {
  const url = new URL(pathname, "https://www.tiktok.com");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildUserDetailUrl(username, msToken) {
  return buildTikTokUrl("/api/user/detail/", {
    uniqueId: username,
    secUid: "",
    msToken,
  });
}

export function buildLikedVideosUrl({ secUid, cursor, msToken }) {
  return buildTikTokUrl("/api/favorite/item_list/", {
    aid: 1988,
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_online: true,
    browser_platform: "MacIntel",
    channel: "tiktok_web",
    cookie_enabled: true,
    count: 30,
    coverFormat: 2,
    cursor,
    device_platform: "web_pc",
    focus_state: true,
    from_page: "user",
    is_fullscreen: false,
    is_page_visible: true,
    language: "en",
    os: "mac",
    priority_region: "PL",
    region: "PL",
    screen_height: 1080,
    screen_width: 1920,
    tz_name: "Europe/Warsaw",
    user_is_login: true,
    secUid,
    msToken,
  });
}

export function extractSecUid(data) {
  return data?.userInfo?.user?.secUid || data?.secUid || null;
}

export function extractUsernameFromUserDetail(data) {
  return data?.userInfo?.user?.uniqueId || data?.user?.uniqueId || null;
}

export function summarizeResponseShape(data) {
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

export function getDefaultTikTokHeaders() {
  return {
    Accept: "application/json",
    Referer: "https://www.tiktok.com/",
    "User-Agent": DESKTOP_UA,
  };
}

export function parseTikTokItem(item) {
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

  if (item.video) {
    if (Array.isArray(item.video.bitrateInfo)) {
      for (const bitrate of item.video.bitrateInfo) {
        const urlList = bitrate?.PlayAddr?.UrlList;
        if (Array.isArray(urlList)) {
          for (const url of urlList) {
            pushUrl(url);
          }
        }
      }
    }

    pushUrl(item.video.playAddr);
    pushUrl(item.video.downloadAddr);
  }

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
