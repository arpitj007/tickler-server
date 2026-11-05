---
layout: home

hero:
  name: Tickler
  text: The calendar your AI agents write to
  tagline: Your agents keep saying "I'll do that later." Tickler makes sure later happens, and shows what your apps earn and your services cost. All on your own server.
  image:
    src: /logo.svg
    alt: ''
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: Connect your AI tools
      link: /connect
    - theme: alt
      text: GitHub
      link: https://github.com/arpitj007/tickler-server

features:
  - title: Agents add entries
    details: Claude Code, the Claude apps, Cursor, Codex, ChatGPT, Gemini CLI and any MCP client can put follow-ups, deadlines, launches and scheduled runs on your calendar.
  - title: Every entry knows where it came from
    details: Tap an entry to jump back to the chat or session that created it, or copy the command that resumes it.
  - title: Money at a glance
    details: Store sales, cloud and AI costs, budgets and month-end forecasts, always with an "as of" time.
  - title: Your server, your data
    details: Runs free on your own Cloudflare account or in Docker. We never see your entries, keys or numbers.
---

## What it looks like

<div class="shots">
  <img src="/screenshots/timeline.png" alt="Day timeline with entries added by agents" />
  <img src="/screenshots/origin.png" alt="An entry's origin card with Open chat" />
  <img src="/screenshots/money.png" alt="The Money tab with revenue, costs and forecast" />
</div>

## Three steps, about 10 minutes

1. **Deploy your server.** One button on Cloudflare (free), or one Docker command. [Deploy on Cloudflare](/guides/deploy-cloudflare) or [with Docker](/guides/deploy-docker).
2. **Pair your phone.** Scan a QR code from your server's setup page with the iPhone or Android app. [Pair your phone](/guides/pair).
3. **Connect your AI tools.** Copy one command or snippet per tool, plus a short instruction block. [Connect your AI tools](/connect).

Want to look around first? The app has a **demo mode** with sample data. No setup needed.

<style>
.shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 16px 0 8px; }
.shots img { width: 100%; border-radius: 16px; border: 1px solid var(--vp-c-divider); }
@media (max-width: 640px) { .shots { grid-template-columns: 1fr; } }
</style>
