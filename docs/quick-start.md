# Quick start

From nothing to "my agent just put something on my phone's calendar" in about 10 minutes.

## Try it first (optional, 1 minute)

Install Tickler on your iPhone or Android phone and tap **See it with demo data**. Every screen works with sample entries, so you can see what you're setting up. Nothing is sent anywhere.

## 1. Deploy your server (about 5 minutes)

Your Tickler server is where your entries live. You run it, so only you can see them. Pick one:

| | Best for | Cost | Public address |
| --- | --- | --- | --- |
| [**Cloudflare**](/guides/deploy-cloudflare) (recommended) | Most people. Nothing to maintain. | Free plan is plenty | Included |
| [**Docker**](/guides/deploy-docker) | Home servers, NAS, VPS | Your own hardware | Add one with [Cloudflare Tunnel](/guides/public-url-cloudflare-tunnel) or [Tailscale Funnel](/guides/public-url-tailscale-funnel) |
| [**I already have one**](/guides/existing-server) | A second phone, or a server someone set up for you | | |

You finish on your server's **setup page** (`/setup`), where you create a passkey or passphrase.

## 2. Pair your phone (1 minute)

On the setup page, press **Pair a phone**, then scan the QR code with the app. [Step by step](/guides/pair).

## 3. Connect your AI tools (2 to 3 minutes each)

The app's **Connect your AI tools** screen shows the exact command or snippet for each tool, with your server's address and a fresh token filled in, and a **Test** button that turns green when the first call arrives.

- [Claude Code](/guides/connect/claude-code) (plus the origin hook, recommended)
- [Claude apps](/guides/connect/claude-apps) (web, desktop, mobile)
- [Cursor](/guides/connect/cursor), [Codex](/guides/connect/codex), [Gemini CLI](/guides/connect/gemini-cli), [ChatGPT](/guides/connect/chatgpt)
- [Anything else that speaks MCP](/guides/connect/other)

Then paste the [instruction block](/guides/instruction-block) into your tool's instructions file, so agents know **when** to add entries.

## 4. Try it

Ask your agent:

```
Remind me tomorrow at 10:00 to check the review comments on this branch.
```

Open the app. The entry is on tomorrow's timeline, and its origin card links back to the session that created it.

## Optional next steps

- [Turn on notifications](/guides/notifications)
- [Connect money sources](/guides/money) to see sales, costs and forecasts (Tickler Pro)
- Read [how Tickler keeps your data safe](/security)
