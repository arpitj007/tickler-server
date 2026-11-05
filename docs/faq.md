# FAQ

## What is Tickler, in one sentence?

A calendar that your AI agents write to: whenever an agent says "I'll do that later", it puts an entry on your Tickler, linked back to the conversation, and your phone reminds you.

## Why is it called Tickler?

A tickler file is the classic reminder system: a folder for every day of the month, so what was promised for later comes back on the right day. That's exactly what this does, for your agents.

## Do I need to run a server?

Yes, Tickler is self-hosted. The easiest way is [one button on Cloudflare](/guides/deploy-cloudflare), on the free plan, with nothing to maintain afterwards. You can also look at the whole app in **demo mode** before setting anything up.

## Can you see my data?

No. There's no Tickler account and no Tickler backend with user data. The app talks only to your server. See [Privacy](/privacy) and [Security](/security).

## Which AI tools work with it?

Anything that speaks MCP. We have step-by-step guides for [Claude Code](/guides/connect/claude-code), the [Claude apps](/guides/connect/claude-apps), [Cursor](/guides/connect/cursor), [Codex](/guides/connect/codex), [ChatGPT](/guides/connect/chatgpt), [Gemini CLI](/guides/connect/gemini-cli) and [T3 Code](/guides/connect/t3-code). Claude Code is the best-tested and the only one with full automatic origin links today.

## Is it on Android?

Yes, Tickler is on iPhone and Android, with the same features. Both pair with the same server, and you can use both at once.

## Is Tickler an AI app? Does it send my data to an AI?

No. There's no AI inside Tickler. Your AI tools call your server; Tickler just stores, shows and reminds.

## How is this different from my normal calendar?

- Entries come from agents, with a link back to the exact chat or session.
- It understands agent work: follow-ups, scheduled runs, launches, renewals, deadlines.
- It shows money: what your apps earn and your services cost.
- It lives on your own server or Cloudflare account, not ours.

## What does it cost?

- The server is free and open source (AGPL-3.0), forever.
- The app is free: Timeline, Projects, Important, origin links, one server and local notifications.
- **Tickler Pro** adds Money (all providers), budgets and alerts, widgets, more than one server and export. Pricing is shown in the app before you buy.
- Hosting on Cloudflare's free plan costs nothing for normal personal use. See [Self-hosting FAQ](/self-hosting-faq).

## Why aren't notifications instant?

Because we don't run a push server (that would mean your data, or at least your devices, going through us). The phone plans reminders itself after each sync. Reminders for entries that synced in advance are on time; budget alerts can be up to an hour late. Details in [Notifications](/guides/notifications).

## Can more than one person use the same server?

Tickler v1 is for one person. You can pair several of your own devices. Team features aren't planned for v1.

## Can I use more than one server?

Yes, with Tickler Pro, for example "Personal" and "Work". Switch between them at the top of the app.

## What happens if I stop paying for Pro?

Your entries, projects and origins keep working. The Pro screens (Money, widgets, extra servers) lock again. Nothing is deleted from your server.

## How do I get my data out?

**Settings, then Export** saves everything as JSON. Your server's database is yours too: on Docker it's a single SQLite file.

## How do I delete everything?

In the app: **Settings, then Disconnect and erase**. On the server: delete the Worker and D1 database in Cloudflare, or the Docker container and its data folder.

## Who makes Tickler?

An independent developer. It isn't affiliated with or endorsed by Anthropic, OpenAI, Google, Cursor or any other company whose tools it works with.
