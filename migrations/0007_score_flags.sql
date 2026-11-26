-- Scores no human could reach (a script answering too fast) are kept out of the rankings
-- until the admin looks: NULL = normal, 'suspect' = set aside, 'cleared' = admin says fine, 'removed' = cheat.
ALTER TABLE scores ADD COLUMN flag TEXT;
CREATE INDEX scores_flag ON scores(flag) WHERE flag IS NOT NULL;
