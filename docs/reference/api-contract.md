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
  `pairing_expired`, `validation_failed` (HTTP 422, with `error.fields: { field: message }`), `internal`,
  `subscription_required` (HTTP 402, Tickler Cloud only: see `cloud-contract.md`).
- Money values are JSON numbers in major units (`12.34`) with an ISO 4217 `currency`.
- Every mutable row carries `rev` (integer). The server keeps one global, monotonically
  increasing sequence; every insert, update or soft delete sets `rev = next_seq()`. Sync uses it.
- Write requests from the apps may send `Idempotency-Key: <uuid>`. The server remembers the
  response for 24 h per device and replays it for a repeated key (offline queue retries).

## Auth

| Caller | Header | Token prefix | Scope |
| --- | --- | --- | --- |
| Paired phone | `Authorization: Bearer tkd_<43 base64url chars>` | `tkd_` | all of `/api/*` except the bridge routes |
| `tickler bridge` | `Authorization: Bearer tkb_<...>` | `tkb_` | only `/api/bridge/heartbeat`, `/api/bridge/next`, `POST /api/dispatches/:id/result` (see [Run in agent](#run-in-agent)) |
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

Instead of `code`, the app may send `"server_key"` (the TICKLER_SECRET it generated before deploying).
Same response; 401 unauthorized if the key is wrong. The rate limit is shared with codes. Tickler Cloud
servers refuse `server_key` (400) and pair through the account (`cloud-contract.md`).
```

## Connecting AI tools

```
POST /api/connect-codes        → 201 { "code": "K7Q2MXRP", "expires_at": "…Z", "command": "curl -fsSL https://…/c/K7Q2MXRP | sh" }
GET  /c/<code>                 (no auth) the shell script; holds no secret. Expired or used codes get a script that says so.
POST /c/<code>                 (no auth, form: clients=claude-code,codex,cursor,gemini-cli&computer=…) single use
                               → text lines "<client> <tkm_token>", one token per tool named "<Tool> on <computer>";
                               a token with the same name is replaced.
GET  /api/approvals            → { "approvals": [{ "id", "client_name", "redirect_host", "match", "created_at", "expires_at" }] }
POST /api/approvals/<id>       { "decision": "allow" | "deny" } → 204 | 404 (expired)
```

When an OAuth client hits `/oauth/authorize` without an admin session, the server makes a pending
approval (10 minutes) and the page waits for the phone, showing the two-digit `match`. Deep link:
`tickler://approve/<id>`.

## Health

`GET /api/health` (no auth) → `{ "ok": true, "name": "tickler", "version": "0.1.0", "api": 1,
"server_name": "Personal", "public_url": "https://..." | null, "hosting": "self" | "cloud" }`

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
  "status": "planned|in_progress|done|skipped|cancelled" /* planned and in_progress are open */, "importance": "normal|important|critical",
  "source": "agent|manual|system", "origin_id": "…" | null, "last_origin_id": "…" | null,
  "origin_flagged": false /* true when the writer sent no origin */,
  "external_key": "…" | null, "links": [{ "title", "url" }], "tags": ["…"], "source_ref": "…" | null,
  "checklist_id": "…" | null /* item of this checklist (same project) */, "parent_id": "…" | null /* subtask of this item */,
  "section": "Security" | null /* group inside the checklist */, "position": 0 /* order inside its section */,
  "completed_at": "…Z" | null, "created_at", "updated_at", "deleted_at": null, "rev" }

// Checklist: a project's guide to "done". Its items are entries with checklist_id set (undated tasks
// unless someone gives them a date); subtasks have parent_id (one level). Soft deleted like entries.
{ "id", "project_id", "name", "kind": "readiness|launch|marketing|compliance|custom" /* one live built-in per kind per project */,
  "description": "…" | null, "position": 0, "source": "agent|manual|system", "origin_id": "…" | null,
  "scanned_at": "…Z" | null /* last time an agent read the product to fill it */, "created_at", "updated_at", "deleted_at": null, "rev" }

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
  "last_message": null /* additive: e.g. the Amazon SNS confirmation note from a webhook */,
  "fields": [{ "key", "label", "secret": true, "multiline"?, "optional"?, "help"? }] /* credential form to render */ }

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
    "projects": [], "checklists": [], "entries": [], "origins": [], "budgets": [], "alerts": [],
    "metric_snapshots": [], "sales_events": [], "fixed_costs": [],
    "deleted": [{ "type": "budget|fixed_cost|project", "id": "..." }] }
```

- `since` omitted or `0` = full snapshot. `cursor` is the max `rev` included, as a string.
  Keep calling while `has_more`.
- Entries are soft deleted (`deleted_at` set), so they arrive as normal rows. Hard-deleted rows
  (budgets, fixed costs) appear in `deleted`.
- `metric_snapshots` in a full snapshot are limited to the last 400 days.

Checklist rules (server enforced on every entry write): `checklist_id` must be a live checklist of the
entry's project; `parent_id` needs `checklist_id` and must be a top-level item of the same checklist.
Moving an entry to another project clears both. Finishing an item (`done`) finishes its open subtasks;
closing its last open subtask finishes the item; reopening a subtask of a done item sets the item to
`in_progress`. Deleting an item deletes its subtasks. Progress counts leaves (items without subtasks,
and subtasks); `cancelled` ones don't count, `done` and `skipped` count as done.

Conflict rule (server enforced on `PATCH /api/entries/:id` and `complete`): last write wins,
except an entry whose status is `done` is never set back to `planned` or `in_progress` by a write whose
`base_updated_at` is older than the entry's `completed_at`. That write gets `409 conflict` with the
current entry in `error.current`; the app drops its change and takes the server copy.

## REST endpoints (device token unless noted)

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/api/projects` | `?archived=true` | `{ projects }` |
| POST | `/api/projects` | `{ id?, name, color?, icon?, slug? }` (`id` lets apps create offline; a repeated id returns the existing project) | `Project` |
| PATCH | `/api/projects/:id` | partial | `Project` |
| DELETE | `/api/projects/:id` | | archives it, `Project` |
| GET | `/api/entries` | `?from&to&project_id&checklist_id&status&importance&q&limit≤500` | `{ entries }` (expanded only by date, recurrence not expanded) |
| GET | `/api/entries/:id` | | `{ entry, origin, last_origin }` |
| POST | `/api/entries` | `Entry` fields (`id` optional: the app may create ids offline) | `Entry` |
| PATCH | `/api/entries/:id` | partial + `base_updated_at` | `Entry` |
| POST | `/api/entries/:id/complete` | `{ status: done|skipped|cancelled|planned|in_progress, note?, base_updated_at? }` | `Entry` |
| POST | `/api/entries/:id/snooze` | `{ start_at }` | `Entry` |
| DELETE | `/api/entries/:id` | | soft delete, `Entry` |
| GET | `/api/checklist-templates` | | `{ templates: [{ kind, name, description, items }], scan_guide }` (`scan_guide`: what an agent should do to fill a checklist; the apps put it in their "build with AI" prompt) |
| GET | `/api/checklists` | `?project_id` | `{ checklists }` (live ones) |
| GET | `/api/checklists/:id` | | `Checklist` + `progress: { done, total, complete }` + `items: [{ id, title, status, importance, section, external_key, notes, start_at, subtasks: [...] }]` |
| POST | `/api/checklists` | `{ id?, project_id, kind, name? /* required for custom */, description?, position?, template? /* default true: add the kind's starter items */ }` | `Checklist`, 201; 200 with the existing one for a repeated id, a built-in kind the project has, or a custom name it has |
| PATCH | `/api/checklists/:id` | `{ name?, description?, position?, scanned_at? }` | `Checklist` |
| DELETE | `/api/checklists/:id` | | soft deletes it and its items, `Checklist` |
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
| POST | `/api/import` | an `/api/export` document | `{ imported: { projects, origins, entries, budgets, alerts, metric_snapshots, sales_events, fixed_costs } }` counts of rows added. Rows keep their ids; ids that exist are skipped. A project with the same `slug` or an origin with the same client session already here is merged into the existing one. Devices, tokens, provider keys and activity are not imported. |

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

## Run in agent

Lets the phone hand a prompt straight to an agent session instead of copying it ("Build with AI",
"Send to chat"). Phones can't type into another app's chat, but the computer the agent runs on can:
each harness has a CLI that resumes a session with a message. So the phone queues a **dispatch**,
and a **bridge** on that computer claims it and runs the harness's CLI.

```
iPhone ──POST /api/dispatches──▶ Tickler server ◀──long poll── tickler bridge (Mac/Linux)
                                                                 │ t3 thread send / claude -p --resume / codex exec resume …
                                                                 ▼
                                                            the agent session
```

### Rules

- **Only paired phones create dispatches.** MCP, OAuth and bridge tokens can't: an agent must never
  be able to queue work into another agent's session, which is how a prompt injection would spread.
  There is no MCP tool for it.
- **The bridge runs messages, never commands.** The runner table is built into the bridge; the
  server only sends the message, the client and the session or folder.
- The message goes to the CLI on **stdin**, never in argv (no shell quoting, no length limit,
  nothing in `ps`). The bridge never adds permission-skipping flags (`--dangerously-skip-permissions`,
  `--yolo`, `--force`, …): the session's own settings decide what the agent may do.
- The bridge runs only in folders under its `roots` (default: the home folder).
- A dispatch no bridge claims within **10 minutes** expires, so a tap doesn't run hours later when
  a laptop wakes. A claim with no result for 10 minutes goes back to the queue once, then `failed`.
- Rate limit: **30 dispatches per hour per phone**. Dispatches are deleted after **30 days**.
- Message: 1 to 16,000 characters.
- Machines match ignoring case and anything after the first dot (`Mac.lan` = `mac.local` = `Mac`):
  hostnames change suffix with the network. The Claude Code hook records `os.hostname()`, and the
  bridge reports the same value as `machine`.

### Runners (built into the bridge)

| client | resume a session | start a new one in `cwd` | checked |
|---|---|---|---|
| `t3_code` | `t3 thread send --json <session_id> -` | `t3 thread start --json <cwd> -` | t3 0.1.3, `--help` |
| `claude_code` | `claude -p --resume <session_id> --output-format json`, in `cwd` | `claude -p --output-format json`, in `cwd` | Claude Code 2.1.308, run |
| `codex` | `codex exec --json resume <session_id> -` | `codex exec --json -C <cwd> -` | codex-cli 0.171.0, `--help` |
| `gemini_cli` | not supported (`--resume` takes "latest" or a list index, not an id) | `gemini --output-format json --prompt ""`, opt in | gemini 0.70.0, `--help` |
| `cursor` | not yet: its CLI takes the prompt as an argument and the docs don't say it reads stdin | | docs |
| `claude_app`, `chatgpt`, `claude_code_web`, `scheduled_task`, `other` | none | none | the app copies instead |

- T3: `session_id` is the thread id; when the origin has none, the server takes it from `open_url`
  (`t3-thread://v1/<thread>`). T3 queues the message as the thread's next turn and never interrupts
  it, so `sent` is final.
- Claude Code, Codex and Gemini run headless in a new process on the same session. The bridge
  reports `running`, waits for the process to exit (default limit 60 minutes), and reports `done` or
  `failed` with the end of the reply. Claude Code finds a session only from the folder it ran in, so
  resuming needs the origin's `cwd`. When Claude Code denied a tool for lack of permission, the
  result is `needs_input`.
- A runner is offered only when its CLI is found on `PATH` (plus `~/.t3/bin`, `~/.local/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`) or set in the bridge config, and isn't turned off there.

### The bridge

`npx tickler bridge install --server <url> --code <code>` (npm package `tickler`, source in
`packages/tickler/`) pairs the computer, copies itself to `~/.tickler/bridge/tickler.mjs` and keeps
running with launchd (`~/Library/LaunchAgents/com.gettickler.bridge.plist`) or a systemd user unit
(`~/.config/systemd/user/tickler-bridge.service`). Without `--server` and `--code` it asks for them.
It sends a heartbeat every 30 s and long-polls for work, running up to 3 dispatches at once.
Other commands: `tickler bridge` (foreground), `status`, `map <project-id> [--cwd .] [--client …]`,
`unmap <project-id>`, `uninstall`.

Config `~/.tickler/bridge.json` (mode 600):

```json
{ "server": "https://tickler.example.com", "token": "tkb_…", "bridge_id": "…",
  "roots": ["/Users/aj"],
  "runners": { "codex": { "enabled": false }, "claude_code": { "path": "/opt/homebrew/bin/claude" }, "gemini_cli": { "enabled": true } },
  "projects": [{ "project_id": "b28b…", "cwd": "/Users/aj/dev/tickler-app", "client": "t3_code" }],
  "timeout_minutes": 60 }
```

`projects` maps a Tickler project to a folder (and optionally a client) for new sessions.

#### `POST /api/bridge-codes` (device)

→ `201 { "code": "K7Q2M9PX", "expires_at": "…", "command": "npx tickler bridge install --server https://… --code K7Q2M9PX" }`.
Single use, valid 15 minutes. The app shows `command`. A `/setup` pairing code also works.

#### `POST /api/bridge/pair` (no auth; 10 per 10 minutes per IP)

`{ "code": "K7Q2M9PX", "machine": "Mac.lan", "name": "AJ's MacBook Pro" }` →
`201 { "bridge_id": "…", "token": "tkb_…", "server": { "name", "version", "api" } }`.
`400 pairing_expired` for an unknown, used or expired code.

#### `POST /api/bridge/heartbeat` (bridge, every 30 s)

```json
{ "machine": "Mac.lan", "name": "AJ's MacBook Pro", "version": "0.1.0",
  "runners": [{ "client": "t3_code", "version": "0.1.3" }, { "client": "claude_code", "version": "2.1.308" }],
  "projects": [{ "project_id": "b28b…", "cwd": "/Users/aj/dev/tickler-app", "client": "t3_code" }] }
```

→ `200 { "bridge": Bridge }`. Runners other than the five runnable clients are dropped.

#### `GET /api/bridge/next?wait=25` (bridge)

Long poll (at most 25 s). Claims the oldest `queued` dispatch for a client this bridge offers (one
with `machine` set only goes to that machine) and returns `200 { "dispatch": Dispatch }` with
`status: "claimed"`, or `204` after `wait` seconds. Also counts as a heartbeat for `online`.

#### `POST /api/dispatches/:id/result` (bridge)

`{ "status": "sent" | "running" | "done" | "failed" | "needs_input", "detail"?: string, "session_id"?: string }`.
Only the bridge that claimed it. `detail` keeps the last 2,000 characters (the end of the agent's
reply, or the error). `session_id` on a new session makes the server create the origin (client,
session id, folder, machine, title from the message's first line, and the `t3-thread://` link for
T3) and set the dispatch's `origin_id`. `409` once the dispatch is final (`done`, `failed`,
`needs_input`, `expired`; `sent` may still move on).

#### `GET /api/bridges` (device)

`200 { "bridges": [Bridge] }`

```json
{ "id": "…", "machine": "Mac.lan", "name": "AJ's MacBook Pro", "version": "0.1.0", "online": true,
  "last_seen_at": "…", "created_at": "…",
  "runners": [{ "client": "t3_code", "version": "0.1.3" }],
  "projects": [{ "project_id": "b28b…", "cwd": "/Users/aj/dev/tickler-app", "client": "t3_code" }] }
```

`online` while the last heartbeat or poll is under 90 s old. `DELETE /api/bridges/:id` (device)
removes a bridge and revokes its token; what it had claimed goes back to the queue.

#### `POST /api/dispatches` (device)

```json
{ "id": "<uuid from the phone>", "project_id": "b28b…", "message": "…",
  "origin_id": "…",                                                  // resume this session, or
  "new_session": { "client": "t3_code", "cwd": "/Users/aj/dev/tickler-app" },  // start one
  "machine": "Mac.lan",                                              // optional; defaults to the origin's machine
  "entry_id": "…", "checklist_id": "…" }                             // optional, for the history on that page
```

Exactly one of `origin_id` and `new_session`. The `id` makes it idempotent: the same id returns the
same dispatch (`200`). → `201 { "dispatch": Dispatch }`. `422 no_runner` when no online bridge
offers that client (on that machine, if one is known), or the session has no id to resume: the app
then copies instead. With no machine and exactly one bridge that can run it, that bridge's machine
is used.

#### `GET /api/dispatches/:id`, `GET /api/dispatches?project_id=&entry_id=&limit=20` (device)

`Dispatch`: `id, project_id, origin_id, client, session_id, cwd, machine, message, entry_id,
checklist_id, status, detail, created_at, updated_at, expires_at`, newest first. Status goes
`queued → claimed → sent | running → done | failed | needs_input`, or `queued → expired`.

#### `DELETE /api/dispatches/:id` (device)

Cancels a dispatch that is still `queued`: it is deleted and never runs (`204`). `409` once claimed.

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

`tickler://entry/<id>`, `tickler://project/<slug>`, `tickler://checklist/<id>`, `tickler://origin/<id>`,
`tickler://money/<provider>`, `tickler://pair?url=…&code=…`, `tickler://approve/<id>`.

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
