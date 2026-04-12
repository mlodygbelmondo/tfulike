// Database types matching our Supabase schema
// These are manually maintained for MVP; use supabase gen types for production

export type RoomStatus = "lobby" | "playing" | "finished";
export type RoundStatus = "voting" | "reveal" | "done";

export interface RoomSettings {
  max_rounds: number | null; // null = auto (players × 3)
  total_rounds?: number; // set at game start
}

export interface Room {
  id: string;
  pin: string;
  host_player_id: string | null;
  status: RoomStatus;
  settings: RoomSettings;
  current_round: number;
  created_at: string;
  updated_at: string;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export interface Player {
  id: string;
  room_id: string;
  nickname: string;
  color: string;
  session_token: string;
  is_host: boolean;
  score: number;
  videos_ready: boolean;
  tiktok_username: string | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface Video {
  id: string;
  room_id: string;
  player_id: string;
  tiktok_url: string | null;
  tiktok_video_id?: string | null;
  video_url: string | null; // direct MP4 URL
  video_urls?: string[] | null;
  used: boolean;
  planned_round_number?: number | null;
  created_at: string;
}

export interface Round {
  id: string;
  room_id: string;
  round_number: number;
  video_id: string | null;
  correct_player_id: string | null;
  status: RoundStatus;
  deadline: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface Vote {
  id: string;
  round_id: string;
  player_id: string;
  guessed_player_id: string;
  is_correct: boolean | null;
  created_at: string;
}

export interface Like {
  id: string;
  player_id: string;
  room_id: string;
  tiktok_video_id: string;
  tiktok_url: string | null;
  video_url: string | null;
  video_urls?: string[] | null;
  author_username: string | null;
  description: string | null;
  cover_url: string | null;
  created_at: string;
}

// Player colors available for selection
export const PLAYER_COLORS = [
  "#ff2d55", // pink/red
  "#5856d6", // purple
  "#ff9500", // orange
  "#34c759", // green
  "#007aff", // blue
  "#ffcc00", // yellow
  "#af52de", // violet
  "#00c7be", // teal
] as const;

// Allowed round count options for host selection
export const ROUND_COUNT_OPTIONS = [3, 6, 7, 10, 15, 25, 35, 50, 100] as const;
