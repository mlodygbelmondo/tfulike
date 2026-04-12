-- Phase 1: Add likes table + sync status for Chrome Extension pipeline
-- This replaces the PrimeAPI-based flow with extension-synced likes

-- ============================================
-- SYNC STATUS ON PLAYERS
-- ============================================

-- Track whether a player's TikTok likes have been synced
-- Values: 'idle' | 'syncing' | 'synced' | 'error'
ALTER TABLE players ADD COLUMN sync_status text NOT NULL DEFAULT 'idle'
  CHECK (sync_status IN ('idle', 'syncing', 'synced', 'error'));

ALTER TABLE players ADD COLUMN sync_error text;
ALTER TABLE players ADD COLUMN synced_at timestamptz;

-- ============================================
-- LIKES TABLE
-- ============================================

CREATE TABLE likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,

  -- TikTok video identifiers
  tiktok_video_id text NOT NULL,
  tiktok_url text,              -- e.g. https://www.tiktok.com/@user/video/123
  video_url text,               -- direct MP4 URL (from extension)

  -- Metadata from TikTok (optional, enrichment)
  author_username text,
  description text,
  cover_url text,

  created_at timestamptz DEFAULT now(),

  -- One like per video per player per room
  UNIQUE(player_id, room_id, tiktok_video_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_likes_player ON likes(player_id);
CREATE INDEX idx_likes_room ON likes(room_id);
CREATE INDEX idx_likes_room_player ON likes(room_id, player_id);
CREATE INDEX idx_players_sync_status ON players(room_id, sync_status);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- Anyone can read likes (needed during game for video selection)
CREATE POLICY likes_select ON likes FOR SELECT USING (true);

-- Insert via Edge Function (service role) or anon for MVP
CREATE POLICY likes_insert ON likes FOR INSERT WITH CHECK (true);

-- Allow upsert (conflict resolution needs update)
CREATE POLICY likes_update ON likes FOR UPDATE USING (true);

-- Allow cleanup
CREATE POLICY likes_delete ON likes FOR DELETE USING (true);

-- ============================================
-- REALTIME
-- ============================================

-- Enable realtime on likes so the web app can track sync progress
ALTER PUBLICATION supabase_realtime ADD TABLE likes;
