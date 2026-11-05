# Connect your AI tools

Tickler is an MCP server, so any AI tool that speaks MCP can add entries to it. Connect as many tools as you like. Each gets its own token, which you can revoke on its own.

## Pick your tool

| Tool | How it connects | Needs a public address? | Guide |
| --- | --- | --- | --- |
| Claude Code | One command, plus an optional origin hook | No (yes for Claude Code on the web) | [Claude Code](/guides/connect/claude-code) |
| Claude apps (web, desktop, mobile) | Custom connector, sign in with OAuth | Yes | [Claude apps](/guides/connect/claude-apps) |
| Cursor | `mcp.json` | No | [Cursor](/guides/connect/cursor) |
| Codex | `config.toml` | No | [Codex](/guides/connect/codex) |
| ChatGPT | Custom connector in developer mode, OAuth | Yes | [ChatGPT](/guides/connect/chatgpt) |
| Gemini CLI | One command or `settings.json` | No | [Gemini CLI](/guides/connect/gemini-cli) |
| T3 Code and other orchestrators | Through the agents they run | Depends | [T3 Code](/guides/connect/t3-code) |
| Anything else | URL plus a header, or OAuth | Depends | [Other clients](/guides/connect/other) |

"Needs a public address" means the tool connects from the cloud, not from your computer. On Cloudflare you always have one. On Docker, see [Cloudflare Tunnel](/guides/public-url-cloudflare-tunnel) or [Tailscale Funnel](/guides/public-url-tailscale-funnel).

## Getting a token

- **In the app:** Settings, then **AI tools**, then pick a tool. The snippet comes with a fresh token already in it.
- **On the setup page:** **AI tools**, then **New token**. You see the token once; copy it right away.

Tokens start with `tkm_`. Only a hash is stored on your server, so a lost token can't be shown again: revoke it and make a new one.

## Then: the instruction block

Connecting gives your agent the tools. The [instruction block](/guides/instruction-block) tells it when to use them. Paste it into `CLAUDE.md`, `AGENTS.md`, Cursor rules or your tool's equivalent.

## The Test button

Each tool's screen in the app has a **Test** button. Press it, then ask your agent anything that adds an entry. The button turns green as soon as your server receives the first call from that tool.
