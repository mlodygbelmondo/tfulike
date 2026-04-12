import { describe, expect, it } from "vitest";

import {
  buildLikedVideosUrl,
  buildUserDetailUrl,
  extractSecUid,
  parseTikTokItem,
  summarizeResponseShape,
} from "./tiktok-sync.js";

describe("buildLikedVideosUrl", () => {
  it("uses the favorite item list endpoint with secUid", () => {
    const url = new URL(
      buildLikedVideosUrl({ secUid: "sec_123", cursor: 60, msToken: "ms_456" })
    );

    expect(url.pathname).toBe("/api/favorite/item_list/");
    expect(url.searchParams.get("secUid")).toBe("sec_123");
    expect(url.searchParams.get("cursor")).toBe("60");
    expect(url.searchParams.get("count")).toBe("30");
    expect(url.searchParams.get("msToken")).toBe("ms_456");
    expect(url.searchParams.get("aid")).toBe("1988");
    expect(url.searchParams.get("user_is_login")).toBe("true");
  });
});

describe("buildUserDetailUrl", () => {
  it("builds the detail endpoint from the TikTok username", () => {
    const url = new URL(buildUserDetailUrl("cool.user", "ms_789"));

    expect(url.pathname).toBe("/api/user/detail/");
    expect(url.searchParams.get("uniqueId")).toBe("cool.user");
    expect(url.searchParams.get("secUid")).toBe("");
    expect(url.searchParams.get("msToken")).toBe("ms_789");
  });
});

describe("extractSecUid", () => {
  it("returns secUid from the standard user detail payload", () => {
    expect(
      extractSecUid({
        userInfo: {
          user: {
            secUid: "resolved_sec_uid",
          },
        },
      })
    ).toBe("resolved_sec_uid");
  });

  it("returns null when the payload does not contain secUid", () => {
    expect(extractSecUid({ userInfo: { user: {} } })).toBeNull();
  });
});

describe("parseTikTokItem", () => {
  it("prefers the best available direct video URL", () => {
    expect(
      parseTikTokItem({
        id: "123",
        desc: "desc",
        author: { uniqueId: "author1" },
        video: {
          downloadAddr: "https://cdn.example.com/download.mp4",
          playAddr: "https://cdn.example.com/play.mp4",
        },
      })
    ).toMatchObject({
      tiktok_video_id: "123",
      tiktok_url: "https://www.tiktok.com/@author1/video/123",
      video_url: "https://cdn.example.com/play.mp4",
    });
  });
});

describe("summarizeResponseShape", () => {
  it("reports useful response diagnostics without full payloads", () => {
    expect(
      summarizeResponseShape({ itemList: [], hasMore: false, cursor: 0, statusCode: 0 })
    ).toEqual({
      keys: ["cursor", "hasMore", "itemList", "statusCode"],
      hasItemList: true,
      itemListLength: 0,
      hasMore: false,
      cursor: 0,
      statusCode: 0,
      statusMsg: null,
    });
  });
});
