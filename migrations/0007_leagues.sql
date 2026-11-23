-- Leagues anyone can create (a streamer and their community, friends…): daily challenge points over a period.
CREATE TABLE leagues (
  code TEXT PRIMARY KEY, -- invite code, also in the share link
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  start_day TEXT NOT NULL, -- first counted day, YYYY-MM-DD (Paris)
  end_day TEXT, -- last counted day, NULL = never ends
  created_at INTEGER NOT NULL
);
CREATE INDEX leagues_owner ON leagues(owner_id);

CREATE TABLE league_members (
  code TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, profile_id)
);
CREATE INDEX league_members_profile ON league_members(profile_id);

-- Daily boards filtered by club join scores to profiles by club.
CREATE INDEX profiles_club ON profiles(club);
