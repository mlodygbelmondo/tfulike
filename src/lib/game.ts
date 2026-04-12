// Shared game logic utilities

import type { RoomSettings } from "./types";

interface RoundOrderCandidate {
  tiktokUrl: string | null;
  videoUrl: string | null;
  videoUrls: string[];
  tiktokVideoId: string;
}

interface RoundAssignment extends RoundOrderCandidate {
  playerId: string;
  plannedRoundNumber: number;
}

export interface StoredProfile {
  nickname: string;
  color: string;
  tiktok: string;
}

/**
 * Validate a TikTok username or profile URL.
 * Accepts:
 *   @username
 *   username
 *   https://www.tiktok.com/@username
 *   https://tiktok.com/@username
 */
export function parseTikTokUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // If it looks like a URL, extract the username from path
  try {
    if (trimmed.startsWith("http")) {
      const url = new URL(trimmed);
      if (
        url.hostname === "www.tiktok.com" ||
        url.hostname === "tiktok.com" ||
        url.hostname === "m.tiktok.com"
      ) {
        const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]+)/);
        if (match) return match[1];
      }
      return null;
    }
  } catch {
    // Not a URL, try as raw username
  }

  // Strip leading @ if present
  const username = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

  // TikTok usernames: letters, digits, underscores, dots; 1-24 chars
  if (/^[a-zA-Z0-9_.]{1,24}$/.test(username)) {
    return username;
  }

  return null;
}

/**
 * Calculate total rounds for a game.
 * No upper cap — the host picks from ROUND_COUNT_OPTIONS.
 */
export function calculateTotalRounds(
  playerCount: number,
  settings: RoomSettings
): number {
  if (settings.max_rounds) return settings.max_rounds;
  return playerCount * 3;
}

export function assignRoundOrder(
  likesByPlayer: Map<string, RoundOrderCandidate[]>,
  totalRounds: number,
  random: () => number = Math.random
): RoundAssignment[] {
  const videoPool = new Map<string, RoundOrderCandidate[]>();

  for (const [playerId, likes] of likesByPlayer) {
    const shuffled = [...likes]
      .sort(() => random() - 0.5)
      .filter((like) => like.videoUrls.length > 0);

    if (shuffled.length > 0) {
      videoPool.set(playerId, shuffled);
    }
  }

  const assignments: RoundAssignment[] = [];

  for (let i = 0; i < totalRounds; i += 1) {
    const candidates: Array<{ playerId: string; weight: number }> = [];

    for (const [playerId, videos] of videoPool) {
      if (videos.length > 0) {
        candidates.push({ playerId, weight: videos.length });
      }
    }

    if (candidates.length === 0) {
      break;
    }

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let threshold = random() * totalWeight;
    let selectedPlayerId = candidates[0].playerId;

    for (const candidate of candidates) {
      threshold -= candidate.weight;
      if (threshold <= 0) {
        selectedPlayerId = candidate.playerId;
        break;
      }
    }

    const video = videoPool.get(selectedPlayerId)?.pop();
    if (!video) {
      continue;
    }

    assignments.push({
      playerId: selectedPlayerId,
      tiktokUrl: video.tiktokUrl,
      videoUrl: video.videoUrl,
      videoUrls: video.videoUrls,
      tiktokVideoId: video.tiktokVideoId,
      plannedRoundNumber: assignments.length + 1,
    });
  }

  return assignments;
}

/**
 * Calculate score for a round
 */
export function calculateRoundScores(
  votes: Array<{
    player_id: string;
    guessed_player_id: string;
    created_at: string;
  }>,
  correctPlayerId: string
): Map<string, number> {
  const scores = new Map<string, number>();
  let correctCount = 0;
  let firstCorrectPlayerId: string | null = null;
  let firstCorrectTime: string | null = null;

  for (const vote of votes) {
    const isCorrect = vote.guessed_player_id === correctPlayerId;
    if (isCorrect) {
      correctCount++;
      scores.set(vote.player_id, (scores.get(vote.player_id) || 0) + 10);

      if (
        !firstCorrectTime ||
        new Date(vote.created_at) < new Date(firstCorrectTime)
      ) {
        firstCorrectTime = vote.created_at;
        firstCorrectPlayerId = vote.player_id;
      }
    }
  }

  // Speed bonus for first correct guesser
  if (firstCorrectPlayerId && correctCount > 1) {
    scores.set(
      firstCorrectPlayerId,
      (scores.get(firstCorrectPlayerId) || 0) + 2
    );
  }

  // Stump bonus if nobody guessed correctly
  if (correctCount === 0) {
    scores.set(correctPlayerId, (scores.get(correctPlayerId) || 0) + 5);
  }

  return scores;
}

/**
 * Generate a session token for reconnection
 */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Session storage keys
 */
export const PROFILE_KEY = "tfulike_profile";
export const TIKTOK_PROFILE_KEY = "tfulike_tiktok";
export const SESSION_KEY = "tfulike_session";

export function getStoredSession(): {
  playerId: string;
  sessionToken: string;
  roomPin: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeSession(
  playerId: string,
  sessionToken: string,
  roomPin: string
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ playerId, sessionToken, roomPin })
  );
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredProfile(): StoredProfile | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;

    const profile = JSON.parse(raw) as Partial<StoredProfile>;
    if (
      typeof profile.nickname !== "string" ||
      typeof profile.color !== "string" ||
      typeof profile.tiktok !== "string"
    ) {
      return null;
    }

    return profile as StoredProfile;
  } catch {
    return null;
  }
}

export function storeProfile(profile: StoredProfile) {
  if (typeof window === "undefined") return;

  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  localStorage.setItem(TIKTOK_PROFILE_KEY, profile.tiktok);
}

export function clearProfile() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(TIKTOK_PROFILE_KEY);
}

/**
 * Store TikTok profile username in localStorage for reuse across sessions
 */
export function getStoredTikTokProfile(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const profile = getStoredProfile();
    return profile?.tiktok || localStorage.getItem(TIKTOK_PROFILE_KEY);
  } catch {
    return null;
  }
}

export function storeTikTokProfile(username: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TIKTOK_PROFILE_KEY, username);
}
