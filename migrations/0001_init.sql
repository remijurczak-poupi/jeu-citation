-- Profiles are tied to a device (no account). The secret doubles as a recovery code.
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  pseudo TEXT NOT NULL,
  pseudo_norm TEXT NOT NULL UNIQUE,
  club TEXT NOT NULL,
  country TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  criterion TEXT NOT NULL,
  board_key TEXT NOT NULL,
  daily_date TEXT,
  started_at INTEGER NOT NULL,
  deadline INTEGER,
  last_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  found TEXT NOT NULL DEFAULT '[]',
  count INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  guesses INTEGER NOT NULL DEFAULT 0,
  end_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX games_device_started ON games(device_id, started_at);
CREATE UNIQUE INDEX games_daily_once ON games(device_id, daily_date) WHERE daily_date IS NOT NULL;

CREATE TABLE scores (
  game_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  board_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX scores_board ON scores(board_key, created_at);
CREATE INDEX scores_board_score ON scores(board_key, score DESC);

-- How often each player is cited per theme: future basis for rarity points.
CREATE TABLE citations (
  theme_key TEXT NOT NULL,
  player TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (theme_key, player)
);
