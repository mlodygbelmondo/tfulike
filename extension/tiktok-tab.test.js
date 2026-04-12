import { describe, expect, it } from "vitest";

import {
  appendSignedUrl,
  chooseTikTokTab,
  parseJsonFromText,
} from "./tiktok-tab.js";

describe("chooseTikTokTab", () => {
  it("prefers an active TikTok tab in the current window", () => {
    const tab = chooseTikTokTab([
      { id: 1, active: false, lastFocusedWindow: true, url: "https://www.tiktok.com/@a" },
      { id: 2, active: true, lastFocusedWindow: true, url: "https://www.tiktok.com/foryou" },
    ]);

    expect(tab?.id).toBe(2);
  });

  it("falls back to the first TikTok tab when none are active", () => {
    const tab = chooseTikTokTab([
      { id: 4, active: false, lastFocusedWindow: false, url: "https://www.tiktok.com/@x" },
      { id: 5, active: false, lastFocusedWindow: false, url: "https://www.tiktok.com/@y" },
    ]);

    expect(tab?.id).toBe(4);
  });

  it("returns null when there is no usable TikTok tab", () => {
    expect(chooseTikTokTab([])).toBeNull();
    expect(chooseTikTokTab([{ id: 9 }])).toBeNull();
  });
});

describe("parseJsonFromText", () => {
  it("throws a readable error when TikTok returns an empty body", () => {
    expect(() => parseJsonFromText("", { step: "detail", status: 200 })).toThrow(
      "TikTok returned an empty response while loading detail"
    );
  });

  it("throws a readable error when TikTok returns HTML instead of JSON", () => {
    expect(() =>
      parseJsonFromText("<html>blocked</html>", { step: "likes", status: 200 })
    ).toThrow("TikTok returned HTML instead of JSON while loading likes");
  });

  it("parses valid JSON text", () => {
    expect(parseJsonFromText('{"itemList":[]}', { step: "likes", status: 200 })).toEqual({
      itemList: [],
    });
  });
});

describe("appendSignedUrl", () => {
  it("adds X-Bogus to an existing TikTok API URL", () => {
    expect(appendSignedUrl("https://www.tiktok.com/api/user/detail/?uniqueId=test", "signed123")).toBe(
      "https://www.tiktok.com/api/user/detail/?uniqueId=test&X-Bogus=signed123"
    );
  });

  it("leaves the URL unchanged when no signature is available", () => {
    expect(appendSignedUrl("https://www.tiktok.com/api/user/detail/?uniqueId=test", "")).toBe(
      "https://www.tiktok.com/api/user/detail/?uniqueId=test"
    );
  });
});
