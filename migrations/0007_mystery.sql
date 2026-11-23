-- Mystery player (second daily game): the day's player is stored the first time the day is asked for,
-- so a past day always keeps the player it had, whatever later data refreshes or code changes do.
CREATE TABLE mystery_days (
  date TEXT PRIMARY KEY,
  player TEXT NOT NULL, -- Wikidata id
  difficulty TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE mystery_games (
  device_id TEXT NOT NULL,
  date TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]', -- JSON MysteryStep[] (guesses keep the player id in "gq")
  used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | won | lost
  archive INTEGER NOT NULL DEFAULT 0, -- started after its day: not ranked
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (device_id, date)
);
CREATE INDEX mystery_games_board ON mystery_games(date, archive, status);
