-- Tickler Cloud control plane (D1 "tickler-cloud"). Customer data never lives here: each customer's
-- entries, tokens and provider keys are in their own server's Durable Object database.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                       -- also the StoreKit appAccountToken
  apple_sub TEXT NOT NULL UNIQUE,            -- Sign in with Apple user id
  email TEXT,
  status TEXT NOT NULL DEFAULT 'new',        -- new | active | grace | expired | deleting
  plan TEXT,                                 -- monthly | yearly
  product_id TEXT,
  expires_at TEXT,
  original_transaction_id TEXT UNIQUE,
  environment TEXT,                          -- Production | Sandbox
  server_id TEXT UNIQUE,
  apple_refresh_enc TEXT,                    -- encrypted Sign in with Apple refresh token, for revocation
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX account_tokens_account ON account_tokens (account_id);

-- App Store Server Notifications are retried; remember which ones were handled.
CREATE TABLE notifications (
  uuid TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
