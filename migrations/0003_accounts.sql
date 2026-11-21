-- Optional sign-in (Google or e-mail link) to find a profile again on another device.
-- A profile can be open on several devices: each one has its own secret.
CREATE TABLE device_sessions (
  secret_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX device_sessions_profile ON device_sessions(profile_id);

CREATE TABLE accounts (
  email TEXT PRIMARY KEY, -- lower case
  profile_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL, -- 'google' or 'email'
  created_at INTEGER NOT NULL
);

-- One-time sign-in links sent by e-mail (15 minutes).
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device_id TEXT, -- profile that asked, linked to the e-mail if it has no account yet
  expires_at INTEGER NOT NULL
);
