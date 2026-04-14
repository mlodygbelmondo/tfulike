import { describe, expect, it } from "vitest";

import {
  buildLikedVideosUrl,
  buildUserDetailUrl,
  extractUsernameFromUserDetail,
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

describe("extractUsernameFromUserDetail", () => {
  it("returns the logged-in TikTok username from the standard user detail payload", () => {
    expect(
      extractUsernameFromUserDetail({
        userInfo: {
          user: {
            uniqueId: "cool.user",
          },
        },
      })
    ).toBe("cool.user");
  });

  it("returns null when the payload does not contain a username", () => {
    expect(extractUsernameFromUserDetail({ userInfo: { user: {} } })).toBeNull();
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
      media_type: "video",
      video_url: "https://cdn.example.com/play.mp4",
    });
  });

  it("extracts photo gallery images and audio from a photo mode item", () => {
    expect(
      parseTikTokItem({
        id: "124",
        desc: "photo mode",
        author: { uniqueId: "author2" },
        imagePost: {
          images: [
            {
              imageURL: {
                urlList: [
                  "https://cdn.example.com/photo-1.jpg",
                  "https://cdn.example.com/photo-1-alt.jpg",
                ],
              },
            },
            {
              imageURL: {
                urlList: ["https://cdn.example.com/photo-2.jpg"],
              },
            },
          ],
        },
        music: {
          playUrl: "https://cdn.example.com/audio.mp3",
        },
      })
    ).toMatchObject({
      tiktok_video_id: "124",
      tiktok_url: "https://www.tiktok.com/@author2/video/124",
      media_type: "photo_gallery",
      video_url: null,
      video_urls: [],
      image_urls: [
        "https://cdn.example.com/photo-1.jpg",
        "https://cdn.example.com/photo-2.jpg",
      ],
      audio_url: "https://cdn.example.com/audio.mp3",
    });
  });

  it("supports snake_case photo mode payloads", () => {
    expect(
      parseTikTokItem({
        id: "125",
        desc: "photo mode",
        author: { uniqueId: "author3" },
        image_post: {
          images: [
            {
              image_url: {
                url_list: ["https://cdn.example.com/photo-3.jpg"],
              },
            },
          ],
        },
        music: {
          play_url: "https://cdn.example.com/audio-2.mp3",
        },
      })
    ).toMatchObject({
      media_type: "photo_gallery",
      image_urls: ["https://cdn.example.com/photo-3.jpg"],
      audio_url: "https://cdn.example.com/audio-2.mp3",
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
