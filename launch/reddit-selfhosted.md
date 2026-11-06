# r/selfhosted

## Rules (summary, verify before posting)

Rules page: https://www.reddit.com/r/selfhosted/about/rules/ (not fetchable automatically; read it by hand).

What we could gather on 2026-11-06 from mirrors of mod posts (https://redlib.groet-infra.nl/r/selfhosted/comments/1rmt39o/rules_update_new_project_friday_here_to_stay/o91wk8x and https://redlib.groet-infra.nl/r/selfhosted/comments/1tqhzoo/new_project_megathread_week_of_28_may_2026/):

- **New projects** (younger than about 3 months) are only allowed in the weekly **New Project Megathread** (it started as "New Project Friday"). Don't make a standalone post for a new project.
- The megathread asks for **transparency about AI involvement** in building the project. Say honestly how much AI was used.
- Older projects may get standalone posts, within the self-promotion rules.
- The community strongly prefers projects that work fully self-hosted. Lead with Docker and say clearly the Cloudflare path is optional.

Our rules: say you're the developer, no vote asking, answer questions, mention the paid app tier up front (the server is free).

## Draft (for the New Project Megathread)

```
Tickler: a self-hosted calendar your AI agents write to (MCP server + phone apps)

I'm the dev. AI disclosure: [describe honestly, e.g. "I wrote the server with heavy help from Claude Code; I review every change"].

What: an MCP server that AI tools (Claude Code, Cursor, Codex, etc.) use to add follow-ups, deadlines and scheduled runs, plus an iPhone/Android app to see them. Every entry links back to the session that created it.

Self-hosting:
- Docker: one container, port 8787, one SQLite file in /data. Compose file in the repo.
- Public URL only needed for cloud AI clients and store webhooks; guides for Cloudflare Tunnel and Tailscale Funnel.
- No telemetry, no phone-home, no account. Backups = copy one file.
- Optional: also runs on Cloudflare Workers free tier if you don't want to host.

License: AGPL-3.0. Server is free. The phone app is free with an optional paid tier (money/budgets, widgets, multiple servers).

Repo: [link] | Docs: [link]
```

## awesome-selfhosted

See `awesome-lists.md`: we don't qualify until 4 months after the first tagged release.
