import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";

import {
  extractLikesFromArchive,
  extractLikesFromJson,
} from "@/lib/tiktok-portability";

const EXPORT_JSON = {
  Activity: {
    "Like List": {
      ItemFavoriteList: [
        {
          Date: "2026-06-01 12:00:00",
          Link: "https://www.tiktokv.com/share/video/7123456789012345678/",
        },
        {
          Date: "2026-06-02 08:30:00",
          Link: "https://www.tiktokv.com/share/video/7999888777666555444/",
        },
      ],
    },
    "Favorite Videos": {
      FavoriteVideoList: [
        {
          Date: "2026-06-03 10:00:00",
          Link: "https://www.tiktokv.com/share/video/7000000000000000001/",
        },
      ],
    },
  },
  Profile: {
    "Profile Information": { userName: "alice" },
  },
};

describe("extractLikesFromJson", () => {
  it("extracts liked videos with ids and dates", () => {
    const likes = extractLikesFromJson(EXPORT_JSON);

    const ids = likes.map((like) => like.tiktok_video_id);
    expect(ids).toContain("7123456789012345678");
    expect(ids).toContain("7999888777666555444");

    const first = likes.find(
      (like) => like.tiktok_video_id === "7123456789012345678",
    );
    expect(first?.tiktok_url).toBe(
      "https://www.tiktokv.com/share/video/7123456789012345678/",
    );
    expect(first?.liked_at).toBe("2026-06-01 12:00:00");
  });

  it("ignores video links outside Like-named sections", () => {
    const likes = extractLikesFromJson(EXPORT_JSON);
    const ids = likes.map((like) => like.tiktok_video_id);
    expect(ids).not.toContain("7000000000000000001");
  });

  it("dedupes repeated video ids and handles lowercase keys", () => {
    const likes = extractLikesFromJson({
      likes: [
        { date: "2026-01-01", link: "https://www.tiktok.com/@a/video/111" },
        { date: "2026-01-02", link: "https://www.tiktok.com/@a/video/111" },
      ],
    });

    expect(likes).toHaveLength(1);
    expect(likes[0].tiktok_video_id).toBe("111");
  });

  it("returns empty for malformed input", () => {
    expect(extractLikesFromJson(null)).toEqual([]);
    expect(extractLikesFromJson("nope")).toEqual([]);
    expect(extractLikesFromJson({ Activity: {} })).toEqual([]);
  });
});

describe("extractLikesFromArchive", () => {
  it("extracts likes from json files inside a zip archive", () => {
    const zip = zipSync({
      "user_data.json": strToU8(JSON.stringify(EXPORT_JSON)),
      "readme.txt": strToU8("not json"),
    });

    const likes = extractLikesFromArchive(zip);
    expect(likes.map((like) => like.tiktok_video_id)).toEqual([
      "7123456789012345678",
      "7999888777666555444",
    ]);
  });

  it("skips invalid json files without failing", () => {
    const zip = zipSync({
      "broken.json": strToU8("{ not json"),
      "user_data.json": strToU8(JSON.stringify(EXPORT_JSON)),
    });

    expect(extractLikesFromArchive(zip)).toHaveLength(2);
  });
});
