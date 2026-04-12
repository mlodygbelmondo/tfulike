export function chooseTikTokTab(tabs) {
  const tiktokTabs = (tabs || []).filter((tab) =>
    typeof tab?.url === "string" && /^https:\/\/(www\.)?tiktok\.com\//.test(tab.url)
  );

  if (tiktokTabs.length === 0) {
    return null;
  }

  return (
    tiktokTabs.find((tab) => tab.active && tab.lastFocusedWindow) ||
    tiktokTabs.find((tab) => tab.active) ||
    tiktokTabs[0]
  );
}

export function parseJsonFromText(text, context) {
  const step = context?.step || "request";
  const status = context?.status ?? "unknown";
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

export function appendSignedUrl(url, signature) {
  if (!signature) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}X-Bogus=${encodeURIComponent(signature)}`;
}
