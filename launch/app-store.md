# App Store listing (iPhone)

Draft for App Store Connect. Character counts were measured on 2026-11-06. Paste the text inside the code blocks.

Limits (checked 2026-11-06, https://developer.apple.com/help/app-store-connect/reference/app-information/app-information and https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information): name 30, subtitle 30, promotional text 170, description 4000, keywords 100 **bytes**, What's New 4000.

## Name and subtitle

| Field | Text | Length |
| --- | --- | --- |
| Name | `Tickler` | 7 / 30 |
| Subtitle | `Calendar for your AI agents` | 27 / 30 |

No AI brand names in name, subtitle or icon (Guidelines 2.3.7, 4.1(c), 5.2.1).

Fallback names if milestone 0 fails, in order: Docket Agent, Laterbook, Promptly Later.

## Category and pricing

- Primary category: **Productivity**. Secondary: **Developer Tools**.
- Price: Free, with in-app purchases (Tickler Pro: monthly, yearly with 7 day trial, lifetime). Final prices are the owner's decision.
- Family Sharing: on for the subscription and lifetime products.

## Promotional text (151 / 170)

```
Agents keep saying "I'll do that later." Tickler puts it on your calendar, links back to the chat that decided it, and keeps it all on your own server.
```

## Description, version A: recommended for 1.0 (2948 / 4000)

No third-party brand names. Use this until a brand owner confirms that compatibility mentions are fine.

```
Your AI agents keep saying "I'll do that later." Tickler makes sure later happens.

Tickler is a calendar your AI agents write to. When a coding agent or chat assistant schedules a follow-up, defers a task, sets up a scheduled run or notes a deadline, it adds an entry to your Tickler through MCP, the open standard AI tools use to connect to apps. You see it on your iPhone, with a link back to the exact conversation that decided it.

YOUR SERVER, YOUR DATA
Tickler is self-hosted. You run a small open-source server in your own Cloudflare account (free plan, one button, about 5 minutes) or with Docker at home. The app talks only to your server. There is no Tickler account, no analytics and no tracking. We never see your entries, your keys or your numbers.

WHAT YOU GET
• Timeline: Day, Week and Month views of everything your agents planned, plus what you add yourself.
• Origins: every entry shows where it came from. Tap Open chat to jump back to the conversation, or copy the command that resumes a coding session on your computer.
• Projects: each project has its own timeline, and Agents & Chats shows what every session promised to do.
• Important: overdue items, deadlines, launches and renewals coming up, with swipe to snooze or mark done.
• Reminders: local notifications for every entry, and 15 minutes early for important ones.

MONEY (TICKLER PRO)
See what your apps earn and what your services cost this month, with a month-end forecast and an "as of" time on every number. Connect app store sales, payment processors, cloud providers and AI API usage with read-only keys that stay on your server. Set budgets and get an alert, and an Important entry, when spending crosses 50%, 80% or 100%.

WORKS WITH YOUR TOOLS
Any AI tool that supports MCP can add entries: coding agents in the terminal, editor assistants, and chat apps with custom connectors. The app shows the exact setup snippet for each tool with your server's address filled in, a Test button, and a short instruction block that tells agents when to use Tickler.

SETUP IN ABOUT 10 MINUTES
1. Deploy your server with one button, or one Docker command.
2. Scan a QR code to pair your phone.
3. Paste one snippet into your AI tool.
Every step has a guide in the app that works offline. Not ready yet? Tap "See it with demo data" and try every screen first.

TICKLER PRO
Free: Timeline, Projects, Important, origin links, one server and local notifications.
Pro adds Money, budgets and alerts, widgets, more than one server (Personal and Work), and export. Choose monthly, yearly with a free trial, or a one-time purchase. Payment is charged to your Apple Account. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period; manage them in your Apple Account settings.

Open source server (AGPL-3.0): github.com/arpitj007/tickler-server
Privacy policy: https://docs.gettickler.com/privacy
Terms: https://docs.gettickler.com/terms
```

## Description, version B: with compatibility line (3189 / 4000)

Use only after checking the brand question below. It names the tools in one factual sentence and adds a trademark notice.

```
Your AI agents keep saying "I'll do that later." Tickler makes sure later happens.

Tickler is a calendar your AI agents write to. When a coding agent or chat assistant schedules a follow-up, defers a task, sets up a scheduled run or notes a deadline, it adds an entry to your Tickler through MCP, the open standard AI tools use to connect to apps. You see it on your iPhone, with a link back to the exact conversation that decided it.

YOUR SERVER, YOUR DATA
Tickler is self-hosted. You run a small open-source server in your own Cloudflare account (free plan, one button, about 5 minutes) or with Docker at home. The app talks only to your server. There is no Tickler account, no analytics and no tracking. We never see your entries, your keys or your numbers.

WHAT YOU GET
• Timeline: Day, Week and Month views of everything your agents planned, plus what you add yourself.
• Origins: every entry shows where it came from. Tap Open chat to jump back to the conversation, or copy the command that resumes a coding session on your computer.
• Projects: each project has its own timeline, and Agents & Chats shows what every session promised to do.
• Important: overdue items, deadlines, launches and renewals coming up, with swipe to snooze or mark done.
• Reminders: local notifications for every entry, and 15 minutes early for important ones.

MONEY (TICKLER PRO)
See what your apps earn and what your services cost this month, with a month-end forecast and an "as of" time on every number. Connect app store sales, payment processors, cloud providers and AI API usage with read-only keys that stay on your server. Set budgets and get an alert, and an Important entry, when spending crosses 50%, 80% or 100%.

WORKS WITH YOUR TOOLS
Works with Claude Code, the Claude apps, Cursor, Codex, ChatGPT (where custom MCP connectors are available), Gemini CLI and any other MCP client. The app shows the exact setup snippet for each tool with your server's address filled in, a Test button, and a short instruction block that tells agents when to use Tickler.

SETUP IN ABOUT 10 MINUTES
1. Deploy your server with one button, or one Docker command.
2. Scan a QR code to pair your phone.
3. Paste one snippet into your AI tool.
Every step has a guide in the app that works offline. Not ready yet? Tap "See it with demo data" and try every screen first.

TICKLER PRO
Free: Timeline, Projects, Important, origin links, one server and local notifications.
Pro adds Money, budgets and alerts, widgets, more than one server (Personal and Work), and export. Choose monthly, yearly with a free trial, or a one-time purchase. Payment is charged to your Apple Account. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period; manage them in your Apple Account settings.

Open source server (AGPL-3.0): github.com/arpitj007/tickler-server
Privacy policy: https://docs.gettickler.com/privacy
Terms: https://docs.gettickler.com/terms

Claude and Claude Code are trademarks of Anthropic, PBC. ChatGPT and Codex are trademarks of OpenAI. Cursor and Gemini are trademarks of their owners. Tickler is an independent app and is not affiliated with or endorsed by them.
```

### What was verified about brand names (2026-11-06)

- Apple 2.3.7 forbids trademarked terms and other apps' names in metadata used to game search, and 5.2.1 forbids using third-party marks without permission. Plain factual compatibility statements in a description are common, but Apple doesn't spell out an exception. **Keywords never contain brand names.**
- Anthropic's trademark guidelines (https://www.anthropic.com/legal/trademark-guidelines) limit use of its marks to what Anthropic permits in approved materials, and don't address "works with Claude" wording. **Not confirmed as allowed.** Owner to-do: email marketing@anthropic.com asking whether "Works with Claude Code and the Claude apps" in a store description is OK.
- OpenAI's brand page (https://openai.com/brand/) couldn't be fetched. Secondary sources say "GPT" can't be in product names, while compatibility phrasing like "for ChatGPT" has been accepted. **Verify by hand.**
- Decision: ship **version A** in 1.0. Switch to version B in a later update once confirmed. In-app setup guides naming each tool are fine either way (that's describing how to configure them), but use only text, no logos, unless a brand's guidelines allow logos.

## Keywords (99 / 100 bytes)

```
ai agent,mcp,calendar,self-hosted,reminders,deadlines,planner,revenue,costs,budget,developer,coding
```

No brand names, no competitor names, no words already in the name or subtitle repeated without reason ("calendar" is kept because it ranks; drop it if Apple flags duplication).

## What's New in 1.0 (570 / 4000)

```
Welcome to Tickler 1.0.

• Day, Week and Month timelines for everything your AI agents plan
• Origin links back to the chat or coding session behind every entry
• Projects, Agents & Chats, and the Important tab
• Pair with your own server by QR code in about a minute
• Step-by-step guides for deploying, pairing and connecting your AI tools, available offline
• Local reminders, with no server of ours involved
• Demo mode to try everything first
• Tickler Pro: Money, budgets, forecasts, widgets and multiple servers

Questions or ideas? Join us on GitHub Discussions.
```

## URLs

- Support URL: https://docs.gettickler.com/support
- Marketing URL: https://docs.gettickler.com
- Privacy policy URL: https://docs.gettickler.com/privacy
- If the domain isn't live yet, use the Cloudflare Pages address of the docs site.

## Age rating answers

Apple's questionnaire (checked 2026-11-06, https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions; ratings 4+, 9+, 13+, 16+, 18+):

| Question group | Answer |
| --- | --- |
| Parental controls, age assurance | No / not applicable |
| Unrestricted web access | No. Links open in the system browser, not an in-app browser. |
| User-generated content shared with others | No. Entries are private to the user's own server. |
| Social media, messaging and chat | No |
| Advertising | No |
| Mature or suggestive themes, profanity, horror, alcohol, tobacco, drugs | None |
| Medical or wellness topics | None |
| Sexuality or nudity | None |
| Violence (cartoon, realistic, prolonged, graphic) | None |
| Simulated gambling, contests, loot boxes | None |

Expected result: **4+**.

## App privacy ("nutrition label")

Answer: **Data Not Collected.**

Reasoning, per https://developer.apple.com/app-store/app-privacy-details/ (checked 2026-11-06): "collect" means transmitting data off the device in a way that lets the developer or its partners access it beyond real-time servicing. Tickler sends data only to a server the user deploys and controls; the developer has no access to it, and there are no analytics, ads or third-party SDKs. Apple's page doesn't explicitly discuss user-hosted servers, so keep the reasoning in the review notes.

- Tracking: **No.**
- Third-party SDKs: none. Purchases use StoreKit 2 on the device.
- Crash data: only Apple's own opt-in diagnostics, which don't count as developer collection.
- Re-check before shipping the v1.1 push relay: it would store an APNs device token on our relay, which likely means declaring **Identifiers: Device ID, not linked to the user, not used for tracking, App Functionality**.

## App Review notes

Paste into App Review Information, Notes. Replace the bracketed values.

```
Tickler is a client app for a server that each user hosts themselves (open source: https://github.com/arpitj007/tickler-server). There is no account with us and no backend of ours.

TWO WAYS TO REVIEW

1) Demo server with sample data (closest to real use)
- Open the app, tap "Set up my server", then "I already have a server", then "Enter code instead".
- Server URL: [DEMO_SERVER_URL]
- Pairing code: [REVIEW_PAIRING_CODE]
This server is hosted by us, contains only fake sample data, and is reset every night. The review pairing code can be used repeatedly.

2) Built-in demo mode (no network needed)
- On the first screen tap "See it with demo data". Every screen works with local sample data, including the Pro screens (marked "Pro").
- To leave demo mode: Settings > Demo mode.

WHAT THE APP DOES
AI tools (coding agents and chat assistants) add entries to the user's own server through MCP, an open protocol. The app shows them on a Day/Week/Month timeline, with a link back to the conversation that created each entry. Pro adds a Money tab showing the user's own app sales and service costs, fetched by the user's server with read-only keys.

IN-APP PURCHASES
Tickler Pro (monthly, yearly with free trial, lifetime) is offered on the Money tab, Widgets settings and Add server screen. It is never shown during onboarding. Restore Purchases is in Settings > Subscription.

ACCOUNT DELETION (5.1.1(v))
The app has no account system: there is no sign-up or login with us. Pairing connects the phone to the user's own server with a device token. Settings > "Disconnect and erase" removes the server address, the token and all local data from the device, and revokes the device on the server.

PRIVACY
No data is collected by the developer. Data goes only between the phone and the server the user runs. No analytics, ads or third-party SDKs.

PERMISSIONS
Camera: only to scan the pairing QR code. Notifications: requested in setup step 5, after an explanation, for local reminders.

Contact: [OWNER NAME], [OWNER EMAIL], [PHONE]
```

Notes for the owner:

- Guideline 2.1(a) asks for a working demo account when an app needs a login, and says a built-in demo mode replaces it only with Apple's prior approval. That's why we give **both** the demo server (acts as the demo account) and demo mode.
- The demo server needs a **reusable review pairing code** that doesn't expire after 10 minutes. Server to-do: support a fixed code, for example through a setting only enabled on the review server, and keep it working through review and every update.
- Keep the demo server up during every review. App Review can take a few days.

## Screenshots: 6 frames, 1320 x 2868 (6.9" iPhone, portrait)

Apple accepts 1320x2868 for the large Dynamic Island iPhone group (checked 2026-11-06, https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications). Use demo data, light mode for 1 to 4 and dark mode for 5 and 6, status bar at 9:41 with full battery. Caption at the top in large text, the app screen below. **No AI brand names or logos in caption text**; client icons inside the app UI must be the app's own generic icons.

| # | Screen | Caption (large) | Sub-caption (small) |
| --- | --- | --- | --- |
| 1 | Day timeline with several agent entries and the now line | Later, handled. | Your AI agents put follow-ups, deadlines and runs on your calendar. |
| 2 | Entry detail with the origin card: Open chat, Copy resume command | Back to where it was decided | Every entry links to the chat or session that created it. |
| 3 | Important tab: Overdue, Next 7 days, Alerts | What matters, first | Overdue items, launches, renewals and budget alerts in one place. |
| 4 | Money tab: revenue, costs, net, forecast with "as of" | Earnings and costs, at a glance | Sales, cloud and AI costs, budgets and forecasts. Pro. |
| 5 | Month view with colored dots and the selected day's agenda | Your month, planned by your agents | Day, Week and Month views for every project. |
| 6 | Setup checklist: Deploy, Pair, Connect, with "about 10 minutes" | Your server. Your data. | Set up in about 10 minutes. We never see your data. |

App preview video: optional, skip for 1.0.

## Icon

A folder tab or calendar page with a small spark, no text. Follow the docs site logo (`docs/public/logo.svg`) as a starting point.
