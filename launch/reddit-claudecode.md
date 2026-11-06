# r/ClaudeCode

The subreddit exists: an unofficial community about Claude Code (about 14k members per https://gummysearch.com/r/ClaudeCode, checked 2026-11-06; may be out of date).

## Rules (summary, verify before posting)

Rules page: https://www.reddit.com/r/ClaudeCode/about/rules/ (not fetchable automatically; read it by hand). Check for: self-promotion limits, required flair, and whether tools/projects posts are allowed on any day.

Our rules: say you're the developer, no vote asking, answer questions, mention the paid tier, rewrite in your own voice.

## Draft

**Title:** A PreToolUse hook + MCP server that turns Claude Code's "later" into calendar entries with a resume command

```
Dev here (I built this). Sharing because the hook part might be useful to others even if you never use my app.

Claude Code often ends with "we should re-check X after Y". I wanted those to land on a calendar with a link back to the session.

How it works:
- An MCP server you self-host (Cloudflare Workers + D1 free tier, or Docker + SQLite) exposes create_entry, list_entries, complete_entry, etc.
- A PreToolUse hook matching mcp__tickler__.* reads session_id, cwd and transcript_path from the hook input, adds git remote, branch and hostname, and returns updatedInput with an `origin` object. So the model never has to know its own session id.
- Each entry stores `cd <cwd> && claude --resume <session_id>`, which I can copy from my phone.
- external_key upserts so re-runs update instead of duplicating.

Setup is `claude mcp add --transport http --scope user tickler <url>/mcp --header "Authorization: Bearer <token>"`, the hook in ~/.claude/settings.json, and a short block in ~/.claude/CLAUDE.md.

Repo (AGPL): [link]. The iPhone/Android app is free with an optional paid tier for money/budget stuff. Feedback on the hook design very welcome.
```
