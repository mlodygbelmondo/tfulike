-- Add resilient video URL candidates for raw TikTok playback.
-- We keep the first candidate in video_url for backward compatibility,
-- but store the full ordered list in video_urls.

ALTER TABLE likes
ADD COLUMN IF NOT EXISTS video_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS video_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE likes
SET video_urls = jsonb_build_array(video_url)
WHERE (video_urls = '[]'::jsonb OR video_urls IS NULL)
  AND video_url IS NOT NULL;

UPDATE videos
SET video_urls = jsonb_build_array(video_url)
WHERE (video_urls = '[]'::jsonb OR video_urls IS NULL)
  AND video_url IS NOT NULL;
