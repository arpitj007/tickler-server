# MCP tools reference

Tickler's MCP server lives at `<your server>/mcp` and speaks **Streamable HTTP**. Auth is a bearer token (`Authorization: Bearer tkm_...`) or OAuth 2.1 with PKCE and dynamic client registration.

Tool results return JSON text plus `structuredContent`.

## Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `create_entry` | `project`, `title`, `start_at`, `origin`; optional `end_at`, `all_day`, `timezone`, `kind`, `notes`, `importance`, `recurrence`, `links`, `tags`, `external_key`, `source_ref` | Creates an entry, or updates it when `external_key` matches one in the same project. Creates the project if it's new. Returns `{ entry, url, created }`, where `url` is `tickler://entry/<id>`. |
| `update_entry` | `id`, or `project` + `external_key`; the fields to change, including `status`; `origin` | Partial update. `status: in_progress` marks it started. |
| `complete_entry` | `id` or key, `status`, `note`, `origin` | Marks an entry done (default), skipped or cancelled; `in_progress` marks it started, `planned` reopens it. |
| `delete_entry` | `id` or key, `origin` | Soft delete (the entry can be restored from the server). |
| `list_entries` | `from`, `to`; optional `project`, `status`, `importance`, `query` | Up to 200 entries. Agents use it to check for duplicates before adding. |
| `list_projects` | | All projects. |
| `create_project` | `name`; optional `color`, `icon` | Creates a project. |
| `mark_important` | `id` or key, `importance`, `reason`, `origin` | Sets `normal`, `important` or `critical`. |
| `list_origins` | optional `client`, `project` | The sessions and chats that wrote to Tickler. |
| `list_checklists` | `project`; optional `checklist` | The project's checklists with progress, items and subtasks. |
| `create_checklist` | `project`, `kind` (`readiness`, `launch`, `marketing`, `compliance`, `custom`); `name` for custom; optional `description`, `template`, `origin` | Makes a checklist. Built-in kinds come with starter items and exist once per project. |
| `add_checklist_items` | `project`, `checklist`, `items` (each `title`, `section`, `notes`, `status`, `importance`, `links`, `external_key`, `subtasks`), optional `scanned`, `origin` | Adds or updates up to 100 items. This is how an agent builds a checklist from the product. Items are keyed by `external_key` (derived from section + title if omitted), so a re-scan updates instead of duplicating. |
| `get_money_summary` | optional `provider`, `month` (`YYYY-MM`) | Month-to-date cost, revenue, forecast and budget status, each with an "as of" time. |

`create_entry` and `update_entry` also take `checklist` (a built-in kind or a custom checklist's name; `null` removes it), `parent` (the `external_key` or id of a checklist item, to make a subtask) and `section`.

## Checklists

Every project (product) can have checklists that say when it's done. Four are built in, each with starter items:

- **Product readiness:** features, quality, security, performance, accessibility, operations.
- **Launch:** store listings, legal pages, pricing, beta, review, release plan.
- **Marketing:** positioning, website, content, channels, after launch.
- **Rules & compliance:** the business rules found in the code and the laws, regulations and store rules that apply, each with a link to its source.

Users add their own (`kind: custom`). Ask your agent "build the readiness checklist for this repo" and it reads the code and calls `add_checklist_items`; items already in place are added as `done`. Entries an agent adds later for the same work carry `checklist`, so the checklist stays the product's north star.

## Field values

- **Times:** ISO 8601 in UTC, like `2026-11-12T09:00:00Z`. Plus `timezone` (IANA, like `Europe/Berlin`) so the app shows it correctly.
- **`kind`:** `task`, `event`, `deadline`, `reminder`, `scheduled_run`, `follow_up`, `launch`, `renewal`.
- **`status`:** `planned` (not started), `in_progress` (started), `done`, `skipped`, `cancelled`. `planned` and `in_progress` are open: not completed, and they can be overdue.
- **`importance`:** `normal`, `important`, `critical`.
- **`recurrence`:** an RFC 5545 RRULE without `DTSTART`, like `FREQ=WEEKLY;BYDAY=MO`.
- **`links`:** `[{ "title": "PR #42", "url": "https://..." }]`.
- **`title`:** up to 120 characters.

## The `origin` object

All fields are optional except `client`.

```json
{
  "client": "claude_code",
  "session_id": "4f1c2a9e-...",
  "title": "Fix flaky checkout test",
  "open_url": "https://...",
  "resume_command": "cd ~/code/shop && claude --resume 4f1c2a9e-...",
  "machine": "macbook",
  "cwd": "/Users/you/code/shop",
  "repo": "github.com/you/shop",
  "branch": "fix/checkout",
  "transcript_path": "/Users/you/.claude/projects/.../4f1c2a9e.jsonl",
  "parent_session_id": null
}
```

`client` is one of `claude_code`, `claude_code_web`, `claude_app`, `cursor`, `chatgpt`, `codex`, `gemini_cli`, `t3_code`, `scheduled_task`, `other`.

Origins are stored once per (`client`, `session_id`) and reused. See [Origins explained](/origins).

## Server rules

- Times more than 2 years in the future are rejected.
- Only `task` entries may have no date.
- 60 writes a minute per token. Beyond that, calls get a rate-limit error.
- Every write is recorded in the activity log, with its token and origin.
- A write with no `origin` is accepted, stored as `other`, and flagged in the app.

## Idempotency with `external_key`

Agents re-run. Give an entry a stable `external_key` (like `pr-42-review` or `cert-renewal-2026`), and calling `create_entry` again with the same project and key updates the entry instead of adding a duplicate. The result's `created` is `false` in that case.

## Example

```json
{
  "name": "create_entry",
  "arguments": {
    "project": "Shop",
    "title": "Check checkout error rate after deploy",
    "start_at": "2026-11-07T09:00:00Z",
    "timezone": "Europe/Berlin",
    "kind": "follow_up",
    "importance": "important",
    "external_key": "deploy-1142-check",
    "source_ref": "https://github.com/you/shop/pull/1142",
    "links": [{ "title": "PR #1142", "url": "https://github.com/you/shop/pull/1142" }],
    "origin": { "client": "claude_code", "session_id": "4f1c2a9e-..." }
  }
}
```
