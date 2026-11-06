# Cloudflare showcase

## What exists (checked 2026-11-06)

- The old "Built with Workers" gallery (workers.cloudflare.com/built-with) now redirects to a page that returns 404, and its submission form dates from 2020. **There's no current official showcase submission page we could find.**
- The active place is the **Cloudflare Developers Discord** (https://discord.cloudflare.com), which has a channel for sharing what you built (reportedly "What I Built" or similar; verify the name and its rules when you join). Source: https://blog.cloudflare.com/meet-the-workers-team-over-discord
- Other options: the Cloudflare Community forum (https://community.cloudflare.com), and tagging Cloudflare's developer accounts when sharing on social media.

## Rules

Read the Discord server's rules channel before posting. Usual norms: post once in the showcase channel, not in help channels; say you're the developer; no vote or star asking.

## Draft (Discord showcase post)

```
Hi all, I'm the developer of Tickler, an open-source (AGPL) server built on Workers + D1 with a Deploy to Cloudflare button.

It's a calendar that AI agents write to over MCP (Streamable HTTP on a Worker), with an OAuth 2.1 server on the same Worker for clients like Claude's custom connectors. Cron Triggers pull usage and cost data, D1 stores everything, and it fits in the free plan for personal use.

Deploy button and docs: [link]. Happy to share what worked and what didn't with D1 migrations and the deploy button.
```

## Why it's worth doing

The Cloudflare path is the recommended setup, so Cloudflare's own community is a good fit, and Deploy button users are likely to be early adopters.
