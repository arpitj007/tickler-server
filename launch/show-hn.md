# Show HN

> **Note for the owner: write this post yourself.** Hacker News asks people not to post generated or AI-edited text (https://news.ycombinator.com/newsguidelines.html, checked 2026-11-06). This file contains only rules, notes and an outline. Don't paste any of it as the post.

## Rules (summary)

From https://news.ycombinator.com/showhn.html (checked 2026-11-06):

- Show HN is for things people can **try**: a working product, ideally without sign-ups. No landing pages or fundraisers.
- Be available to answer questions in the thread.
- Don't ask friends to upvote or comment. Don't use HN mainly for promotion.
- No quickly generated one-offs.
- Title starts with `Show HN:`.

## What makes it "try-able" for HN

- The server repo link (open source, AGPL-3.0) is the natural target URL: readers can read the code and deploy in minutes.
- Demo mode in the apps works without sign-up.
- Consider linking the repo, not the App Store, and mentioning the apps in the text.

## Outline (for you to write in your own words)

1. **Title idea:** `Show HN: Tickler, a self-hosted calendar that AI agents write to via MCP` (pick your own wording).
2. **The itch:** the concrete moment agents promised "later" and it got lost.
3. **What it is:** server (Hono, TypeScript, one codebase on Workers + D1 or Docker + SQLite), MCP tools, phone apps.
4. **The interesting technical bits HN may like:**
   - Origins: how the Claude Code PreToolUse hook rewrites tool input to attach session id and a `claude --resume` command, so the model never has to know its own session id.
   - Idempotent upserts with `external_key` so agent re-runs don't duplicate.
   - Notifications without a backend: local notifications re-planned on each sync, and the honest "up to an hour late" trade-off.
   - Money: honest freshness ("as of", provider lag), 7 day run-rate forecast.
5. **Privacy stance:** no account, no backend of yours.
6. **How it's paid for:** server free forever; the app has a Pro tier. Be upfront.
7. **What you want feedback on.**

## Notes

- Post on a weekday morning US time; stay for several hours.
- Expect questions about: why not CalDAV/ICS, why AGPL, prompt injection risk, how origin works for remote connectors. Have short honest answers ready (the security page covers prompt injection).
- If it doesn't take off, don't repost the same thing soon.
