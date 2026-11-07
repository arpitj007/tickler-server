# Tickler Cloud contract (v1)

Tickler comes two ways: **Cloud** (we host a server for you) and **self-hosted** (you run it).
Each Cloud customer gets their own unchanged Tickler server, so the phone, MCP clients and
`api-contract.md` work the same for both. This file only adds what Cloud needs on top: accounts,
billing and provisioning. It lives next to `api-contract.md`; change both together.

Implementation: `src/cloud/` (control plane, Durable Object server, router), `migrations-cloud/`,
`wrangler.cloud.jsonc`. Tests: `test/cloud/` (Node) and `test/cloud-workers/` (workerd).

Conventions are the same as `api-contract.md` (JSON, `snake_case`, ISO 8601 UTC, error shape).

## Plans

| Plan | Products | Who hosts | Includes |
| --- | --- | --- | --- |
| Free | n/a | user | the app with a self-hosted server, free limits |
| Pro | `tickler.pro.monthly` $2.99, `tickler.pro.yearly` $19.99, `tickler.pro.lifetime` $49.99 | user | every Pro feature |
| Cloud | `tickler.cloud.monthly` $5.99, `tickler.cloud.yearly` $49.99 (7-day trial) | us | hosting plus every Pro feature |

Cloud requires a subscription (no free Cloud tier) and has no lifetime option. The subscriptions
share one App Store subscription group, with Cloud ranked above Pro, so a user holds at most one
and Apple prorates upgrades and downgrades.

## Hosts

- Control plane: `https://tickler.cloud` (accounts, billing, provisioning).
- Customer servers: `https://<server_id>.tickler.cloud`, where `server_id` is 10 chars from
  `abcdefghjkmnpqrstuvwxyz23456789`. Always use the `url` the API returns rather than building it.
- Staging (no domain): control plane `https://tickler-cloud-staging.vela-xtream.workers.dev`, customer
  servers at `https://tickler-cloud-staging.vela-xtream.workers.dev/s/<server_id>`. OAuth discovery
  uses path insertion: `/.well-known/oauth-protected-resource/s/<server_id>/mcp`. Staging accepts
  sandbox (TestFlight, Xcode) transactions; production accepts only `Production` ones. Each serves the full `api-contract.md` surface, plus `/mcp` and
  `/oauth/*`, backed by its own Durable Object SQLite database (a third `Storage` adapter next to D1
  and SQLite). The global money/daily crons become per-server Durable Object alarms.

## Auth

| Caller | Header | Prefix | Scope |
| --- | --- | --- | --- |
| App (account) | `Authorization: Bearer tka_<43 base64url chars>` | `tka_` | `https://tickler.cloud/v1/*` |

Device (`tkd_`) and MCP (`tkm_`, `tko_`) tokens are unchanged and are minted by the customer's own
server. As everywhere else, only SHA-256 hashes are stored.

## Account

```
Account {
  "id": "uuid",                  // also the StoreKit appAccountToken for purchases
  "email": "…" | null,           // from Sign in with Apple; may be a private relay address
  "status": "new" | "active" | "grace" | "expired" | "deleting",
  "plan": "monthly" | "yearly" | null,
  "expires_at": "…Z" | null,
  "server": { "id": "k7q2mxrpab", "url": "https://k7q2mxrpab.tickler.cloud" } | null,
  "created_at": "…Z"
}
```

- `new`: signed in, never subscribed, no server yet.
- `active`: subscribed; the server exists.
- `grace`: Apple billing retry/grace period; everything still works.
- `expired`: the server is read-only for 30 days (reads, `/api/export` and `/api/changes` work; writes,
  including MCP writes, return `402 { "error": { "code": "subscription_required", … } }`). Then it is deleted.
- `deleting`: the user deleted the account; data is purged within 24 h.

## Endpoints

```
POST /v1/accounts/apple                (no auth)
{ "identity_token": "<JWT>", "authorization_code": "…", "nonce": "<raw nonce>" }
→ 200 { "account": Account, "account_token": "tka_…" }
  Creates the account on first sign-in, otherwise signs in to the existing one. The server verifies
  the JWT against Apple's keys and the SHA-256 of `nonce`, and exchanges the authorization code for
  a refresh token (needed to revoke the Apple token when the account is deleted).
→ 401 unauthorized (bad token)

GET    /v1/accounts/me                 → Account
DELETE /v1/accounts/me                 → 202 Account (status "deleting"); revokes the Apple token,
                                         cancels nothing in the App Store (the app tells the user to
                                         cancel the subscription in Settings)

POST /v1/accounts/me/transactions
{ "signed_transaction": "<StoreKit 2 JWS>" }
→ 200 Account
  The app calls this right after a purchase and on every launch with its current Cloud entitlement.
  The server verifies the JWS (Apple x5c chain, bundle id, environment), checks
  `appAccountToken == account.id`, updates status and creates the server on first activation.
  Idempotent. A still-valid transaction does not lift `grace` (only a renewal notification does).
→ 400 bad_request (not verifiable, or not a `tickler.cloud.*` product: Pro is never sent here)
→ 409 conflict (appAccountToken is another account's, or the subscription is linked to another account)

POST /v1/accounts/me/devices
{ "device_name": "AJ's iPhone", "platform": "ios" | "android" }
→ 200 { "url": "https://k7q2mxrpab.tickler.cloud", "device_id": "…", "token": "tkd_…",
        "server": { "name": "Tickler Cloud", "version": "0.1.0", "api": 1 } }
  Pairs this phone with the account's server (same response as POST /api/pair, plus `url`).
→ 402 subscription_required (status "new", or past the read-only window so there is no server)
  Pairing still works while `expired` within the window, so people can export.

POST /v1/webhooks/app-store            App Store Server Notifications v2: { "signedPayload": "…" }
                                       → 200 (also for duplicates and non-Cloud products), 401 bad signature.
                                       DID_FAIL_TO_RENEW → grace; EXPIRED, GRACE_PERIOD_EXPIRED, REFUND,
                                       REVOKE → expired; anything else → from the transaction's expiry.
GET  /v1/health                        (no auth) → { "ok": true, "name": "tickler-cloud", "version", "api" }
POST /v1/webhooks/google-play          Play Real-time Developer Notifications (later)
```

- `tka_` tokens don't expire. Each sign-in issues a new one; deleting the account deletes them all.
- Sign-in is rate limited to 20 per IP per 10 minutes; account calls to 120 a minute.

## Changes to the customer server (both modes)

- `GET /api/health` adds `"hosting": "cloud" | "self"`.
- Cloud servers have no `/setup` secret or admin passphrase: `/` and `/setup` show a "managed from
  the Tickler app" page, and `POST /api/pair` refuses `server_key`. OAuth connector sign-in (Claude
  apps, ChatGPT) uses the in-app approvals (`/api/approvals`).
- New `POST /api/import` (device token): takes a `/api/export` document and merges it, so people can
  move between Cloud and self-hosted in either direction. Details in `api-contract.md`.
- While `expired`: every `POST`/`PATCH`/`PUT`/`DELETE` under `/api` returns
  `402 { "error": { "code": "subscription_required", "message": … } }`, except `/api/approvals/*`
  and `DELETE /api/devices/*`. MCP write tools (`create_entry`, `update_entry`, `complete_entry`,
  `delete_entry`, `mark_important`, `create_project`) return a tool error whose text starts with
  `subscription_required:` (an MCP tool result with `isError: true`, HTTP 200), so agents can read
  it. Reads, `/api/changes` and `/api/export` keep working. Money syncs stop.
- Each Cloud server's provider keys are encrypted with its own key, derived from the Cloud secret.

## App behavior

- Onboarding offers both: "Tickler Cloud" (Sign in with Apple, subscribe, ready in seconds) and
  "Your own server" (today's Cloudflare/Docker flow).
- An active Cloud subscription unlocks Pro everywhere in the app.
- Settings shows, for a Cloud server: plan, renewal date, Manage subscription, Export data,
  Move to my own server, Delete account (required by App Review guideline 5.1.1(v)).
- The account token lives in the Keychain under `cloud.account`.
