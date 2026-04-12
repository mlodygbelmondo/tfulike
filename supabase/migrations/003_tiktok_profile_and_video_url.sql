-- Add TikTok username to players (profile link or @handle)
ALTER TABLE players ADD COLUMN tiktok_username text;

-- Add direct video URL (MP4) to videos table
ALTER TABLE videos ADD COLUMN video_url text;

-- Make tiktok_url nullable (new flow may not have original URLs)
ALTER TABLE videos ALTER COLUMN tiktok_url DROP NOT NULL;

-- Add delete policy for videos (was missing)
CREATE POLICY videos_delete ON videos FOR DELETE USING (true);
