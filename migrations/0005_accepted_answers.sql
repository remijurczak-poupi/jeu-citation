-- Answers accepted by hand after a report: the player counts for that exact theme from now on.
CREATE TABLE accepted_answers (
  theme_key TEXT NOT NULL,
  player TEXT NOT NULL, -- Wikidata id
  report_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (theme_key, player)
);
