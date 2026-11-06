# Tickler API contract (v1)

The single source of truth shared by the server, the iOS app and the Android app. If you need to
change it, change this file in the same commit as the code.

Product spec: `/Users/aj/dev/tickler-prompt.md` (the app repo is `tickler-app`, iOS + Android).

## Conventions

- JSON, `snake_case` keys. Times are ISO 8601 UTC strings with `Z` (`2026-11-06T09:00:00.000Z`).
  Dates without time are `YYYY-MM-DD`. Months are `YYYY-MM`.
- IDs are UUID v4 strings, lowercase.
- Errors: HTTP 4xx/5xx with `{ "error": { "code": "not_found", "message": "..." } }`.
  Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`,
  `pairing_expired`, `validation_failed` (then `error.fields: { field: message }`), `internal`.
- Money values are JSON numbers in major units (`12.34`) with an ISO 4217 `currency`.
- Every mutable row carries `rev` (integer). The server keeps one global, monotonically
  increasing sequence; every insert, update or soft delete sets `rev = next_seq()`. Sync uses it.
- Write requests from the apps may send `Idempotency-Key: <uuid>`. The server remembers the
  response for 24 h per device and replays it for a repeated key (offline queue retries).

## Auth

| Caller | Header | Token prefix | Scope |
| --- | --- | --- | --- |
| Paired phone | `Authorization: Bearer tkd_<43 base64url chars>` | `tkd_` | all of `/api/*` |
| MCP client | `Authorization: Bearer tkm_<...>` | `tkm_` | `/mcp`, `POST /api/metrics` |
| OAuth MCP client | `Authorization: Bearer <access token from /oauth/token>` | `tko_` | `/mcp` |
| Admin (browser) | session cookie `tickler_session` set by `/setup` login | n/a | `/setup/*` |

Only SHA-256 hashes of tokens are stored. Plaintext is returned exactly once.

## Pairing

1. Admin opens `/setup` → "Pair a phone" → server creates a pairing code: 8 chars from
   `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, single use, valid 10 minutes.
2. QR payload: `tickler://pair?url=<urlencoded base URL, no trailing slash>&code=<code>`.
   The page shows the URL and code as text too (manual entry fallback).
3. App calls (no auth):

```
POST /api/pair
{ "code": "K7Q2MXRP", "device_name": "AJ's iPhone", "platform": "ios" | "android" }
→ 200 { "device_id": "...", "token": "tkd_...", "server": { "name": "Personal", "version": "0.1.0", "api": 1 } }
→ 400 pairing_expired | 404 not_found (wrong code) | 429 rate_limited
```

## Health

`GET /api/health` (no auth) → `{ "ok": true, "name": "tickler", "version": "0.1.0", "api": 1,
"server_name": "Personal", "public_url": "https://..." | null }`

`GET /api/me` → `{ "device": Device, "server_name": "Personal" }`

## Objects

```jsonc
// Project
{ "id", "name", "slug", "color": "#RRGGBB", "icon": "folder" /* SF Symbol name; Android maps it */,
  "archived": false, "created_at", "updated_at", "rev" }

// Entry
{ "id", "project_id", "title" /* ≤120 */, "notes": "markdown" | null,
  "kind": "task|event|deadline|reminder|scheduled_run|follow_up|launch|renewal",
  "start_at": "…Z" | null /* null only for kind=task */, "end_at": "…Z" | null, "all_day": false,
  "timezone": "Europe/Berlin" /* IANA */, "recurrence": "FREQ=WEEKLY;BYDAY=MO" | null /* RRULE, no DTSTART */,
  "status": "planned|done|skipped|cancelled", "importance": "normal|important|critical",
  "source": "agent|manual|system", "origin_id": "…" | null, "last_origin_id": "…" | null,
  "origin_flagged": false /* true when the writer sent no origin */,
  "external_key": "…" | null, "links": [{ "title", "url" }], "tags": ["…"], "source_ref": "…" | null,
  "completed_at": "…Z" | null, "created_at", "updated_at", "deleted_at": null, "rev" }

// Origin
{ "id", "client": "claude_code|claude_code_web|claude_app|cursor|chatgpt|codex|gemini_cli|t3_code|scheduled_task|other",
  "session_id", "title", "open_url", "resume_command", "machine", "cwd", "repo", "branch",
  "transcript_path", "parent_origin_id", "first_seen_at", "last_seen_at", "rev" }
  // all but id/client/first_seen_at/last_seen_at/rev may be null

// Device
{ "id", "name", "platform": "ios|android|other", "created_at", "last_seen_at", "current": true }

// McpToken (never includes the token)
{ "id", "name", "scopes": ["mcp"], "created_at", "last_used_at" }

// Activity
{ "id", "at", "actor_type": "device|mcp_token|oauth_client|admin|system", "actor_id", "actor_name",
  "origin_id", "action": "create_entry|update_entry|...|POST /api/entries", "summary" }

// ProviderStatus
{ "provider": "app_store|google_play|amazon_appstore|stripe|cloudflare|google_cloud|aws|anthropic|openai|github|manual",
  "display_name", "kind": "revenue|cost", "configured": true, "enabled": true,
  "freshness": "hourly", "needs_public_url": false, "public_url_ok": true,
  "last_sync_at", "last_error": null, "guide": "providers/stripe",
  "last_message": null /* additive: e.g. the Amazon SNS confirmation note from a webhook */ }

// MetricSnapshot
{ "id", "provider", "account", "metric": "revenue|proceeds|units|cost|usage|forecast",
  "unit": "USD" /* currency code, or "tokens", "requests"… */, "value": 12.3, "label": "claude-opus-5-5" | null,
  "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "fetched_at", "source_latency": "~1 day", "rev" }

// Budget
{ "id", "provider": "aws" | null /* null = all costs */, "project_id": null, "monthly_limit": 100,
  "currency": "USD", "thresholds": [0.5, 0.8, 1.0], "created_at", "updated_at", "rev" }

// Alert
{ "id", "budget_id", "month": "2026-11", "threshold": 0.8, "entry_id", "value", "created_at", "rev" }

// SalesEvent
{ "id", "store": "app_store|google_play|amazon_appstore|stripe", "type": "purchase|trial_started|subscribed|renewed|refunded|cancelled|billing_issue",
  "product_id", "price", "currency", "country", "occurred_at", "rev" }

// FixedCost
{ "id", "name", "amount", "currency", "interval": "monthly|yearly", "renews_on": "YYYY-MM-DD",
  "project_id": null, "created_at", "updated_at", "rev" }
```

## Sync

```
GET /api/changes?since=<cursor>&limit=500
→ { "cursor": "1234", "has_more": false,
    "projects": [], "entries": [], "origins": [], "budgets": [], "alerts": [],
    "metric_snapshots": [], "sales_events": [], "fixed_costs": [],
    "deleted": [{ "type": "budget|fixed_cost|project", "id": "..." }] }
```

- `since` omitted or `0` = full snapshot. `cursor` is the max `rev` included, as a string.
  Keep calling while `has_more`.
- Entries are soft deleted (`deleted_at` set), so they arrive as normal rows. Hard-deleted rows
  (budgets, fixed costs) appear in `deleted`.
- `metric_snapshots` in a full snapshot are limited to the last 400 days.

Conflict rule (server enforced on `PATCH /api/entries/:id` and `complete`): last write wins,
except an entry whose status is `done` is never set back to `planned` by a write whose
`base_updated_at` is older than the entry's `completed_at`. That write gets `409 conflict` with the
current entry in `error.current`; the app drops its change and takes the server copy.

## REST endpoints (device token unless noted)

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/api/projects` | `?archived=true` | `{ projects }` |
| POST | `/api/projects` | `{ name, color?, icon?, slug? }` | `Project` |
| PATCH | `/api/projects/:id` | partial | `Project` |
| DELETE | `/api/projects/:id` | | archives it, `Project` |
| GET | `/api/entries` | `?from&to&project_id&status&importance&q&limit≤500` | `{ entries }` (expanded only by date, recurrence not expanded) |
| GET | `/api/entries/:id` | | `{ entry, origin, last_origin }` |
| POST | `/api/entries` | `Entry` fields (`id` optional: the app may create ids offline) | `Entry` |
| PATCH | `/api/entries/:id` | partial + `base_updated_at` | `Entry` |
| POST | `/api/entries/:id/complete` | `{ status: done|skipped|cancelled|planned, note?, base_updated_at? }` | `Entry` |
| POST | `/api/entries/:id/snooze` | `{ start_at }` | `Entry` |
| DELETE | `/api/entries/:id` | | soft delete, `Entry` |
| GET | `/api/origins` | `?client&project_id` | `{ origins }` |
| GET | `/api/origins/:id` | | `{ origin, entries, parent }` |
| GET | `/api/devices` | | `{ devices }` |
| DELETE | `/api/devices/:id` | `me` allowed | 204 |
| GET | `/api/tokens` | | `{ tokens }` |
| POST | `/api/tokens` | `{ name }` | `{ token: McpToken, secret: "tkm_..." }` |
| DELETE | `/api/tokens/:id` | | 204 |
| GET | `/api/oauth-clients` / DELETE `/api/oauth-clients/:id` | | `{ clients: [{id,name,created_at,last_used_at}] }` |
| GET | `/api/activity` | `?before=<iso>&limit≤200` | `{ activity }` |
| GET | `/api/mcp/last-call` | `?since=<iso>` | `{ at, client, token_name } | { at: null }` (powers the "Test" button) |
| GET | `/api/connect` | | `{ mcp_url, clients: [{ id, name, snippet, docs }] , instruction_block }` with this server's URL filled in |
| GET | `/api/money/summary` | `?month=YYYY-MM` | see below |
| GET | `/api/money/providers` | | `{ providers: [ProviderStatus] }` |
| PUT | `/api/money/providers/:provider` | `{ credentials: {..}, enabled }` | `ProviderStatus` (credentials never returned) |
| DELETE | `/api/money/providers/:provider` | | 204 |
| POST | `/api/money/providers/:provider/test` | | `{ ok, message }` |
| POST | `/api/money/providers/:provider/sync` | | `ProviderStatus` |
| GET | `/api/money/series` | `?provider&metric&from&to` | `{ points: [{ date, value, unit }] }` daily |
| GET/POST/PATCH/DELETE | `/api/budgets[/:id]` | `Budget` fields | `Budget` |
| GET | `/api/sales-events` | `?store&limit≤200` | `{ events }` |
| GET/POST/PATCH/DELETE | `/api/fixed-costs[/:id]` | `FixedCost` fields | `FixedCost` |
| POST | `/api/metrics` | device or `tkm_` token: `{ provider: "manual", account?, metric, unit, value, period_start, period_end?, label? }` | `MetricSnapshot` |
| GET | `/api/export` | | everything as one JSON (no secrets) |

Money summary:

```jsonc
{ "month": "2026-11", "currency": "USD",
  "revenue": { "value": 812.4, "as_of": "…Z" }, "costs": { "value": 143.1, "as_of": "…Z" },
  "net": { "value": 669.3, "as_of": "…Z" },
  "forecast": { "revenue": 1500, "costs": 260, "net": 1240, "method": "provider|run_rate_7d|mixed" },
  "providers": [{ "provider", "kind", "month_to_date", "currency", "forecast", "forecast_method",
                  "budget": Budget | null, "budget_used": 0.42 | null, "as_of", "freshness",
                  "top_lines": [{ "label", "value" }] }],
  "stores": [{ "store", "proceeds", "units", "new_subscriptions", "renewals", "refunds", "trials",
               "currency", "as_of" }],
  "notes": ["…"] /* additive: caveats, e.g. amounts left out of totals because of another currency */ }
```

Currency: v1 reports everything in the user's base currency (`TICKLER_CURRENCY`, default USD);
providers in another currency are converted only if the provider gives a converted amount,
otherwise shown separately and excluded from totals with a note.

## MCP

Streamable HTTP at `/mcp` (stateless). Tools, inputs and behaviour exactly as section 6 of the spec.
Tool results return JSON text plus `structuredContent`. `create_entry` returns
`{ entry, url: "tickler://entry/<id>", created: true|false }`.

`origin` input object (all optional except `client`):
`{ client, session_id, title, open_url, resume_command, machine, cwd, repo, branch,
transcript_path, parent_session_id }`. Upserted on (`client`, `session_id`); without
`session_id` a new origin row per call is avoided by keying on (`client`, `title`, token id, day).
When a call has no `origin`, the entry gets `origin_flagged: true` and an origin whose `client` is
guessed from the OAuth client name or User-Agent (`claude_app`, `chatgpt`, ...), else `other`.

Store webhooks: `POST /hooks/<store>` for `app_store`, `google_play`, `amazon_appstore`, `stripe`;
`/hooks/apple`, `/hooks/google`, `/hooks/amazon` are aliases.

Review/demo servers only: when `TICKLER_DEMO_PAIRING_CODE` is set, `POST /api/pair` always accepts
that code (never expires, never used up). Never set it on a real server.

## Deep links (apps)

`tickler://entry/<id>`, `tickler://project/<slug>`, `tickler://origin/<id>`,
`tickler://money/<provider>`, `tickler://pair?url=…&code=…`.

## Demo data

`seed/demo-changes.json` in `tickler-server` is a full `/api/changes` response (cursor `"0"`
base) with realistic fake data, dated relative to `"__NOW__"` placeholders resolved at load:
every time field may be written as `"__NOW__+P2DT3H"` / `"__NOW__-PT30M"` (ISO 8601 duration
offset from now, rounded to the minute) and the apps resolve it at load time. The server seed
script and both apps' demo modes load this same file. Apps copy it in at build time via
`tickler-app/scripts/sync-shared.sh`.

Placeholder details (additive):
- Bases: `__NOW__` (now, rounded down to the minute), `__TODAY__` (today 00:00 UTC),
  `__MONTH_START__` (first day of the current UTC month), `__MONTH_END__` (last day of it).
  `__MONTH__` is the same as `__MONTH_START__`. The offset is optional: `[+-]P[nD][T[nH][nM]]`.
- Field format after resolving: date fields (`period_start`, `period_end`, `renews_on`) take the
  UTC date `YYYY-MM-DD`; `month` takes `YYYY-MM`; every other field takes the full ISO instant.
- All-day entries use `__TODAY__±nD` so they land on midnight UTC.
- Reference resolver: `resolveDemo()` in `tickler-server/scripts/seed-data.ts`.
- Metric snapshots: a day's money total has `label: null` (or `"currency:XXX"`); rows with any
  other label are breakdown lines (model, service) for `top_lines` and are not added to totals.
