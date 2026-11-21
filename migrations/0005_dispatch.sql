-- Run in agent: the phone queues a dispatch, a `tickler bridge` on the user's computer claims it and runs
-- the agent's own CLI. See docs/reference/api-contract.md, "Run in agent".
CREATE TABLE bridges (
  id TEXT PRIMARY KEY,
  machine TEXT NOT NULL,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  version TEXT,
  runners TEXT NOT NULL DEFAULT '[]',
  projects TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE bridge_codes (
  code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE dispatches (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  project_id TEXT,
  origin_id TEXT,
  client TEXT NOT NULL,
  session_id TEXT,
  cwd TEXT,
  machine TEXT,
  message TEXT NOT NULL,
  entry_id TEXT,
  checklist_id TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  bridge_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX dispatches_status ON dispatches (status, created_at);
CREATE INDEX dispatches_project ON dispatches (project_id, created_at);
