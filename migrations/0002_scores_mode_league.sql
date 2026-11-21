-- Rankings by mode (all themes together) and badges by league need the mode and league of each score.
ALTER TABLE scores ADD COLUMN mode TEXT;
ALTER TABLE scores ADD COLUMN league TEXT; -- league of the theme ('PL', 'L1'…), NULL when the theme has none
UPDATE scores SET mode = substr(board_key, 1, instr(board_key, ':') - 1);
CREATE INDEX scores_mode_created ON scores(mode, created_at);
CREATE INDEX scores_league ON scores(league, device_id);
