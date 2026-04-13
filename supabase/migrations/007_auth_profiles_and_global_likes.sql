-- Phase 1: Auth profiles + global likes
-- Introduces Supabase Auth-based profiles and moves likes to be per-user
-- instead of per-room.

-- ============================================
-- PROFILES TABLE
-- ============================================

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  color text NOT NULL DEFAULT '#007aff',
  avatar_url text,              -- Google profile photo URL (nullable)
  tiktok_username text,
  sync_status text NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'syncing', 'synced', 'error')),
  sync_error text,
  synced_at timestamptz,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- USER_LIKES TABLE (global per-user, not per-room)
-- ============================================

CREATE TABLE user_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- TikTok video identifiers
  tiktok_video_id text NOT NULL,
  tiktok_url text,
  video_url text,
  video_urls jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Metadata
  author_username text,
  description text,
  cover_url text,

  created_at timestamptz DEFAULT now(),

  -- One like per video per user (global)
  UNIQUE(user_id, tiktok_video_id)
);

CREATE INDEX idx_user_likes_user ON user_likes(user_id);
CREATE INDEX idx_user_likes_video ON user_likes(tiktok_video_id);

-- ============================================
-- ALTER PLAYERS: add user_id FK
-- ============================================

ALTER TABLE players ADD COLUMN user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX idx_players_user ON players(user_id);

-- ============================================
-- RLS POLICIES — profiles
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (needed for game display)
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (true);

-- Users can only insert their own profile
CREATE POLICY profiles_insert ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- Users can only update their own profile
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================
-- RLS POLICIES — user_likes
-- ============================================

ALTER TABLE user_likes ENABLE ROW LEVEL SECURITY;

-- Anyone can read likes (needed for game start to pull videos)
CREATE POLICY user_likes_select ON user_likes
  FOR SELECT USING (true);

-- Users can only insert their own likes
CREATE POLICY user_likes_insert ON user_likes
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can only update their own likes
CREATE POLICY user_likes_update ON user_likes
  FOR UPDATE USING (user_id = auth.uid());

-- Users can only delete their own likes
CREATE POLICY user_likes_delete ON user_likes
  FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE user_likes;

-- ============================================
-- AUTO-CREATE PROFILE ON AUTH SIGNUP
-- ============================================

-- Creates a profile row when a user signs up via Supabase Auth.
-- Pulls nickname from Google metadata (full_name or email prefix).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  raw_meta jsonb;
  display_name text;
  photo text;
BEGIN
  raw_meta := NEW.raw_user_meta_data;

  -- Try Google full_name, fall back to email prefix
  display_name := COALESCE(
    raw_meta->>'full_name',
    raw_meta->>'name',
    split_part(NEW.email, '@', 1)
  );

  photo := raw_meta->>'avatar_url';

  INSERT INTO public.profiles (id, nickname, avatar_url)
  VALUES (NEW.id, display_name, photo)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
