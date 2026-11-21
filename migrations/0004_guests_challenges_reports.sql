-- Guest profiles (created on the first game, before any nickname is chosen).
ALTER TABLE profiles ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;

-- Asynchronous challenges: a friend replays the same mode and theme (and chain start) as a finished game.
CREATE TABLE challenges (
  code TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  criterion TEXT NOT NULL,
  start TEXT, -- chain mode: the challenger's starting player
  count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
ALTER TABLE games ADD COLUMN challenge TEXT;
CREATE INDEX games_challenge ON games(challenge) WHERE challenge IS NOT NULL;

-- "This answer should have counted" reports, reviewed by hand.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  game_id TEXT,
  text TEXT NOT NULL,
  recognised TEXT, -- player the game thought it was, if any
  criterion TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX reports_status ON reports(status, created_at);
