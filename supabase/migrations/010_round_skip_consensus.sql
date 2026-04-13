-- Persist per-round skip consensus so every player must agree before a video is skipped.

CREATE TABLE IF NOT EXISTS round_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES rounds(id) ON DELETE CASCADE NOT NULL,
  player_id uuid REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(round_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_round_skips_round ON round_skips(round_id);

ALTER TABLE round_skips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "round_skips_select" ON round_skips FOR SELECT USING (true);
CREATE POLICY "round_skips_insert" ON round_skips FOR INSERT WITH CHECK (true);
CREATE POLICY "round_skips_delete" ON round_skips FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE round_skips;
