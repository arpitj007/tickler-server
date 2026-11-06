-- Tickler schema v1. Used by both runtimes (wrangler d1 migrations format; the Node runner
-- applies the same files and records them in the same d1_migrations table).
-- Keep one statement per ";" at end of line (the runner splits on that). No triggers.

CREATE TABLE seq (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);
INSERT INTO seq (id, value) VALUES (1, 0);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  passphrase_hash TEXT NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL
);
CREATE INDEX projects_rev ON projects (rev);

CREATE TABLE origins (
  id TEXT PRIMARY KEY,
  origin_key TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  session_id TEXT,
  title TEXT,
  open_url TEXT,
  resume_command TEXT,
  machine TEXT,
  cwd TEXT,
  repo TEXT,
  branch TEXT,
  transcript_path TEXT,
  parent_origin_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  rev INTEGER NOT NULL
);
CREATE INDEX origins_rev ON origins (rev);
CREATE INDEX origins_session ON origins (client, session_id);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  importance TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'manual',
  origin_id TEXT,
  last_origin_id TEXT,
  origin_flagged INTEGER NOT NULL DEFAULT 0,
  external_key TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  source_ref TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX entries_external_key ON entries (project_id, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX entries_rev ON entries (rev);
CREATE INDEX entries_start ON entries (start_at);
CREATE INDEX entries_origin ON entries (origin_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'other',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["mcp"]',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  origin_id TEXT,
  action TEXT NOT NULL,
  summary TEXT
);
CREATE INDEX activity_at ON activity (at);

CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE idempotency_keys (
  actor_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, key)
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE tombstones (
  rev INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  client_secret_hash TEXT,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX oauth_tokens_client ON oauth_tokens (client_id);

CREATE TABLE provider_configs (
  provider TEXT PRIMARY KEY,
  credentials_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'default',
  metric TEXT NOT NULL,
  unit TEXT NOT NULL,
  value REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_latency TEXT,
  raw TEXT,
  rev INTEGER NOT NULL,
  UNIQUE (provider, account, metric, label, period_start, period_end)
);
CREATE INDEX metric_snapshots_rev ON metric_snapshots (rev);
CREATE INDEX metric_snapshots_period ON metric_snapshots (provider, metric, period_start);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  provider TEXT,
  project_id TEXT,
  monthly_limit REAL NOT NULL,
  currency TEXT NOT NULL,
  thresholds TEXT NOT NULL DEFAULT '[0.5,0.8,1.0]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  month TEXT NOT NULL,
  threshold REAL NOT NULL,
  entry_id TEXT,
  value REAL NOT NULL,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL,
  UNIQUE (budget_id, month, threshold)
);

CREATE TABLE sales_events (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  external_id TEXT NOT NULL,
  type TEXT NOT NULL,
  product_id TEXT,
  price REAL,
  currency TEXT,
  country TEXT,
  occurred_at TEXT NOT NULL,
  raw TEXT,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL,
  UNIQUE (store, external_id)
);
CREATE INDEX sales_events_rev ON sales_events (rev);
CREATE INDEX sales_events_at ON sales_events (occurred_at);

CREATE TABLE fixed_costs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  interval TEXT NOT NULL,
  renews_on TEXT NOT NULL,
  project_id TEXT,
  reminded_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL
);
