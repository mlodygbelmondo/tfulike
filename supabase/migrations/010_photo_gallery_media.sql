-- Add support for TikTok Photo Mode / image galleries with optional audio.

ALTER TABLE user_likes
ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'video'
  CHECK (media_type IN ('video', 'photo_gallery')),
ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS audio_url text;

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'video'
  CHECK (media_type IN ('video', 'photo_gallery')),
ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS audio_url text,
ADD COLUMN IF NOT EXISTS cover_url text;

UPDATE user_likes
SET media_type = CASE
  WHEN jsonb_array_length(COALESCE(image_urls, '[]'::jsonb)) > 0 THEN 'photo_gallery'
  ELSE 'video'
END;

UPDATE videos
SET media_type = CASE
  WHEN jsonb_array_length(COALESCE(image_urls, '[]'::jsonb)) > 0 THEN 'photo_gallery'
  ELSE 'video'
END;
