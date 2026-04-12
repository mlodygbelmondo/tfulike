import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseTikTokUsername,
  calculateTotalRounds,
  calculateRoundScores,
  assignRoundOrder,
  generateSessionToken,
  SESSION_KEY,
  PROFILE_KEY,
  getStoredSession,
  storeSession,
  clearSession,
  getStoredProfile,
  storeProfile,
  clearProfile,
  getStoredTikTokProfile,
  storeTikTokProfile,
} from "@/lib/game";
import type { RoomSettings } from "@/lib/types";

// ─── parseTikTokUsername ────────────────────────────────────────────

describe("parseTikTokUsername", () => {
  it("accepts @username format", () => {
    expect(parseTikTokUsername("@cooluser")).toBe("cooluser");
  });

  it("accepts bare username format", () => {
    expect(parseTikTokUsername("cooluser")).toBe("cooluser");
  });

  it("accepts www.tiktok.com profile URL", () => {
    expect(
      parseTikTokUsername("https://www.tiktok.com/@cooluser")
    ).toBe("cooluser");
  });

  it("accepts tiktok.com profile URL", () => {
    expect(
      parseTikTokUsername("https://tiktok.com/@cooluser")
    ).toBe("cooluser");
  });

  it("accepts m.tiktok.com profile URL", () => {
    expect(
      parseTikTokUsername("https://m.tiktok.com/@cooluser")
    ).toBe("cooluser");
  });

  it("extracts username from profile URL with trailing path", () => {
    expect(
      parseTikTokUsername("https://www.tiktok.com/@cool.user_1/video/123")
    ).toBe("cool.user_1");
  });

  it("rejects non-TikTok URLs", () => {
    expect(parseTikTokUsername("https://www.youtube.com/@user")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseTikTokUsername("")).toBeNull();
  });

  it("rejects whitespace only", () => {
    expect(parseTikTokUsername("   ")).toBeNull();
  });

  it("rejects usernames with special characters", () => {
    expect(parseTikTokUsername("user name!")).toBeNull();
  });

  it("accepts usernames with dots and underscores", () => {
    expect(parseTikTokUsername("user.name_123")).toBe("user.name_123");
  });

  it("trims whitespace", () => {
    expect(parseTikTokUsername("  @cooluser  ")).toBe("cooluser");
  });
});

// ─── calculateTotalRounds ───────────────────────────────────────────

describe("calculateTotalRounds", () => {
  it("returns max_rounds when set", () => {
    const settings: RoomSettings = { max_rounds: 10 };
    expect(calculateTotalRounds(4, settings)).toBe(10);
  });

  it("does not cap max_rounds (host picks from allowed options)", () => {
    const settings: RoomSettings = { max_rounds: 100 };
    expect(calculateTotalRounds(4, settings)).toBe(100);
  });

  it("uses playerCount * 3 when max_rounds is null", () => {
    const settings: RoomSettings = { max_rounds: null };
    expect(calculateTotalRounds(5, settings)).toBe(15);
  });

  it("auto-calculated rounds are uncapped", () => {
    const settings: RoomSettings = { max_rounds: null };
    expect(calculateTotalRounds(20, settings)).toBe(60);
  });

  it("handles max_rounds of 0 (falsy) as auto mode", () => {
    const settings: RoomSettings = { max_rounds: 0 as unknown as null };
    expect(calculateTotalRounds(3, settings)).toBe(9);
  });

  it("works for minimum 3 players with null rounds", () => {
    const settings: RoomSettings = { max_rounds: null };
    expect(calculateTotalRounds(3, settings)).toBe(9);
  });
});

// ─── calculateRoundScores ───────────────────────────────────────────

describe("calculateRoundScores", () => {
  const correctPlayerId = "owner";

  it("awards stump bonus even when there are no votes at all", () => {
    const scores = calculateRoundScores([], correctPlayerId);
    expect(scores.size).toBe(1);
    expect(scores.get(correctPlayerId)).toBe(5);
  });

  it("awards stump bonus (5 pts) when nobody guesses correctly", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: "wrong", created_at: "2025-01-01T00:00:00Z" },
      { player_id: "p2", guessed_player_id: "wrong", created_at: "2025-01-01T00:00:01Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get(correctPlayerId)).toBe(5);
    expect(scores.has("p1")).toBe(false);
    expect(scores.has("p2")).toBe(false);
  });

  it("awards 10 pts for a correct guess", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:00Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get("p1")).toBe(10);
  });

  it("does NOT award speed bonus when only one person guesses correctly", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:00Z" },
      { player_id: "p2", guessed_player_id: "wrong", created_at: "2025-01-01T00:00:01Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get("p1")).toBe(10);
  });

  it("awards speed bonus (+2) to fastest when multiple guess correctly", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:05Z" },
      { player_id: "p2", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:01Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get("p2")).toBe(12);
    expect(scores.get("p1")).toBe(10);
  });

  it("does not award stump bonus when at least one correct", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:00Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.has(correctPlayerId)).toBe(false);
  });

  it("handles multiple correct guesses with same timestamps", () => {
    const ts = "2025-01-01T00:00:00Z";
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: ts },
      { player_id: "p2", guessed_player_id: correctPlayerId, created_at: ts },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get("p1")).toBe(12);
    expect(scores.get("p2")).toBe(10);
  });

  it("mixed correct and incorrect votes", () => {
    const votes = [
      { player_id: "p1", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:00Z" },
      { player_id: "p2", guessed_player_id: "wrong", created_at: "2025-01-01T00:00:01Z" },
      { player_id: "p3", guessed_player_id: correctPlayerId, created_at: "2025-01-01T00:00:02Z" },
    ];
    const scores = calculateRoundScores(votes, correctPlayerId);
    expect(scores.get("p1")).toBe(12);
    expect(scores.get("p3")).toBe(10);
    expect(scores.has("p2")).toBe(false);
    expect(scores.has(correctPlayerId)).toBe(false);
  });
});

describe("assignRoundOrder", () => {
  it("preserves a deterministic planned order without reusing the same video", () => {
    const assignments = assignRoundOrder(
      new Map([
        [
          "p1",
          [
            {
              tiktokUrl: "https://www.tiktok.com/@alice/video/1",
              videoUrl: "https://cdn.example.com/1.mp4",
              videoUrls: ["https://cdn.example.com/1.mp4"],
              tiktokVideoId: "1",
            },
          ],
        ],
        [
          "p2",
          [
            {
              tiktokUrl: "https://www.tiktok.com/@bob/video/2",
              videoUrl: "https://cdn.example.com/2.mp4",
              videoUrls: ["https://cdn.example.com/2.mp4"],
              tiktokVideoId: "2",
            },
          ],
        ],
      ]),
      2,
      () => 0
    );

    expect(assignments).toEqual([
      {
        playerId: "p1",
        tiktokUrl: "https://www.tiktok.com/@alice/video/1",
        videoUrl: "https://cdn.example.com/1.mp4",
        videoUrls: ["https://cdn.example.com/1.mp4"],
        tiktokVideoId: "1",
        plannedRoundNumber: 1,
      },
      {
        playerId: "p2",
        tiktokUrl: "https://www.tiktok.com/@bob/video/2",
        videoUrl: "https://cdn.example.com/2.mp4",
        videoUrls: ["https://cdn.example.com/2.mp4"],
        tiktokVideoId: "2",
        plannedRoundNumber: 2,
      },
    ]);
  });
});

// ─── generateSessionToken ───────────────────────────────────────────

describe("generateSessionToken", () => {
  it("returns a valid UUID-like string", () => {
    const token = generateSessionToken();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("generates unique tokens on each call", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toBe(t2);
  });
});

// ─── Session storage helpers ────────────────────────────────────────

describe("session storage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("storeSession", () => {
    it("uses the tfulike session storage key", () => {
      expect(SESSION_KEY).toBe("tfulike_session");
    });

    it("stores session data in localStorage", () => {
      storeSession("p1", "tok123", "1234");
      const raw = localStorage.getItem(SESSION_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({
        playerId: "p1",
        sessionToken: "tok123",
        roomPin: "1234",
      });
    });
  });

  describe("getStoredSession", () => {
    it("returns null when nothing stored", () => {
      expect(getStoredSession()).toBeNull();
    });

    it("returns parsed session when present", () => {
      storeSession("p2", "tok456", "5678");
      expect(getStoredSession()).toEqual({
        playerId: "p2",
        sessionToken: "tok456",
        roomPin: "5678",
      });
    });

    it("returns null for corrupt data", () => {
      localStorage.setItem(SESSION_KEY, "not-json");
      expect(getStoredSession()).toBeNull();
    });
  });

  describe("clearSession", () => {
    it("removes session from localStorage", () => {
      storeSession("p3", "tok789", "9999");
      clearSession();
      expect(getStoredSession()).toBeNull();
    });
  });
});

// ─── TikTok profile storage ────────────────────────────────────────

describe("TikTok profile storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing stored", () => {
    expect(getStoredTikTokProfile()).toBeNull();
  });

  it("stores and retrieves profile", () => {
    storeTikTokProfile("cooluser");
    expect(getStoredTikTokProfile()).toBe("cooluser");
  });

  it("overwrites previous profile", () => {
    storeTikTokProfile("old");
    storeTikTokProfile("new");
    expect(getStoredTikTokProfile()).toBe("new");
  });
});

// ─── Stored profile helpers ─────────────────────────────────────────

describe("stored profile helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no profile is stored", () => {
    expect(getStoredProfile()).toBeNull();
  });

  it("uses the tfulike profile storage key", () => {
    expect(PROFILE_KEY).toBe("tfulike_profile");
  });

  it("stores and retrieves nickname, color, and TikTok username", () => {
    storeProfile({
      nickname: "Alice",
      color: "#ff2d55",
      tiktok: "cooluser",
    });

    expect(getStoredProfile()).toEqual({
      nickname: "Alice",
      color: "#ff2d55",
      tiktok: "cooluser",
    });

    expect(JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}")).toEqual({
      nickname: "Alice",
      color: "#ff2d55",
      tiktok: "cooluser",
    });
  });

  it("returns null for corrupt stored profile data", () => {
    localStorage.setItem(PROFILE_KEY, "not-json");
    expect(getStoredProfile()).toBeNull();
  });

  it("clears the stored profile", () => {
    storeProfile({
      nickname: "Alice",
      color: "#ff2d55",
      tiktok: "cooluser",
    });

    clearProfile();

    expect(getStoredProfile()).toBeNull();
  });
});
