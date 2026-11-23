-- Each day's challenge is frozen the first time it is served, so later data refreshes
-- (which change club sizes, seasons, etc.) cannot rewrite past days.
CREATE TABLE daily_challenges (
  date TEXT PRIMARY KEY,      -- YYYY-MM-DD (Paris)
  criterion TEXT NOT NULL,    -- JSON Criterion
  created_at INTEGER NOT NULL
);

-- Recover the days already played: the theme most players actually got that day.
INSERT OR IGNORE INTO daily_challenges (date, criterion, created_at)
SELECT daily_date, criterion, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM (
  SELECT daily_date, criterion,
         ROW_NUMBER() OVER (PARTITION BY daily_date ORDER BY COUNT(*) DESC, MIN(started_at)) AS rn
    FROM games
   WHERE mode = 'daily' AND daily_date IS NOT NULL
   GROUP BY daily_date, criterion
) WHERE rn = 1;
