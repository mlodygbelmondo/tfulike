-- Persist the planned round order so every client sees the same video sequence.

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS tiktok_video_id text,
ADD COLUMN IF NOT EXISTS planned_round_number int;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_room_round_number
ON rounds(room_id, round_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_room_planned_round_number
ON videos(room_id, planned_round_number)
WHERE planned_round_number IS NOT NULL;
