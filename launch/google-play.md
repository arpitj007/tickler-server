# Google Play listing (Android)

Draft for the Play Console. Counts measured 2026-11-06.

Limits (checked 2026-11-06, https://support.google.com/googleplay/android-developer/answer/9859152): title 30, short description 80, full description 4000. Play's metadata policy (https://support.google.com/googleplay/android-developer/answer/9898842) forbids misleading or repetitive keywords and third-party logos without permission; graphics must not say "Best", "#1" or "download now" (https://support.google.com/googleplay/android-developer/answer/9866151).

## Title (26 / 30)

```
Tickler: AI Agent Calendar
```

Alternative if the owner prefers the plain name: `Tickler` (7). The "AI Agent Calendar" part is generic, not a brand.

## Short description (74 / 80)

```
The calendar your AI agents write to. Self-hosted: your server, your data.
```

## Full description (2934 / 4000)

Same brand decision as the App Store: no third-party AI brand names in 1.0 (see `app-store.md`, "What was verified about brand names"). Swap in the compatibility paragraph from version B there once confirmed.

```
Your AI agents keep saying "I'll do that later." Tickler makes sure later happens.

Tickler is a calendar your AI agents write to. When a coding agent or chat assistant schedules a follow-up, defers a task, sets up a scheduled run or notes a deadline, it adds an entry to your Tickler through MCP, the open standard AI tools use to connect to apps. You see it on your phone, with a link back to the exact conversation that decided it.

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
Pro adds Money, budgets and alerts, home screen widgets, more than one server (Personal and Work), and export. Choose monthly, yearly with a free trial, or a one-time purchase. Purchases go through Google Play. Subscriptions renew automatically until cancelled; manage or cancel them any time in Google Play, Payments and subscriptions.

Open source server (AGPL-3.0): github.com/arpitj007/tickler-server
Privacy policy: https://docs.gettickler.com/privacy
Terms: https://docs.gettickler.com/terms
```

## Category, tags, contact

- App category: **Productivity**.
- Tags (pick in the Play Console from Google's list): Calendar, Productivity, To-do list or the closest available.
- Contact email: support@gettickler.com. Website: https://docs.gettickler.com. Privacy policy: https://docs.gettickler.com/privacy.
- Ads: **No, this app contains no ads.**

## Data safety form

Answers (checked against https://support.google.com/googleplay/android-developer/answer/10787469 on 2026-11-06):

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not shown when nothing is collected. (All traffic to the user's server is HTTPS, except a home-network server the user sets up with `http://`.) |
| Do you provide a way for users to request that their data is deleted? | Not shown when nothing is collected. In the app: Settings, Disconnect and erase. |

Reasoning: Play counts data as "collected" when it's sent off the device, and its exemptions cover data sent to a user's own storage account that the developer never accesses. A self-hosted server the user controls isn't named explicitly. Tickler never sends data to the developer or any third party; it sends data only to the server address the user enters. **Verify:** if a reviewer disagrees, the fallback is to declare "Personal info: other (entries)" and "App activity: other" as collected, **processed for App functionality**, **not shared**, **encrypted in transit**, **user can request deletion**, and explain the self-hosted setup in the policy. Note this decision in the owner to-dos.

Also declare:

- Purchases: handled by Google Play Billing; the developer receives only Google's reports. Not "collected" by the app.
- No SDKs that collect data (no analytics, no crash reporting libraries, no ads).
- Camera: used on device only for the QR code; nothing transmitted.

## Content rating (IARC questionnaire)

Required for every app (https://support.google.com/googleplay/android-developer/answer/9898843).

| Question | Answer |
| --- | --- |
| Category | Utility, Productivity, Communication or Other (choose "Utility / Productivity") |
| Violence, fear, sexuality, language, controlled substances | No |
| Gambling or simulated gambling | No |
| Users can interact or exchange content with other users | No |
| Shares the user's location with other users | No |
| Allows purchases of digital goods | Yes (Tickler Pro) |
| Unrestricted internet access (web browser, search) | No |

Expected: **Everyone / PEGI 3 / USK 0**.

## Target audience and content

- Target age: **18 and over** (a developer productivity tool; avoids Families policy requirements). It's fine for all ages content-wise.
- Not designed for children. No ads.
- Government app: No. Financial features: No (it shows the user's own reports; no money is moved). Health: No. News: No.

## App access (for review)

Choose **All or some functionality is restricted** and add instructions (https://support.google.com/googleplay/android-developer/answer/15748846 asks for reusable, always-valid details, in English, without two-factor steps):

```
Tickler is a client for a server the user hosts. There is no account with us.

Option 1 (no login): on the first screen tap "See it with demo data". Every screen works with local sample data.

Option 2 (demo server): tap "Set up my server" > "I already have a server" > "Enter code instead".
Server URL: [DEMO_SERVER_URL]
Pairing code: [REVIEW_PAIRING_CODE] (reusable, always valid)
The demo server holds only fake data and resets nightly.

Tickler Pro screens (Money, widgets) are visible in demo mode with a "Pro" tag. "Disconnect and erase" in Settings removes all local data.
```

## Graphics

### Feature graphic, 1024 x 500

JPEG or 24-bit PNG, no transparency. Plan:

- Left: the app icon and the word **Tickler**, with "The calendar your AI agents write to".
- Right: a phone frame cropped to the Day timeline with three agent entries.
- No AI brand names or logos, no "Best", no "#1", no buttons drawn in.

### Phone screenshots

Play allows 2 to 8 per device type; at least 4 at 1080 x 1920 or larger qualify for recommendations. Use 8 frames at **1080 x 2400** (or render the same art as the iPhone frames at 1320 x 2868, which is within the ratio limit). Same captions and rules as the App Store plan in `app-store.md`, plus:

| # | Screen | Caption |
| --- | --- | --- |
| 1 | Day timeline | Later, handled. |
| 2 | Origin card | Back to where it was decided |
| 3 | Important | What matters, first |
| 4 | Money | Earnings and costs, at a glance |
| 5 | Month view | Your month, planned by your agents |
| 6 | Setup checklist | Your server. Your data. |
| 7 | Home screen widget with next 3 entries | Your next steps, on your home screen |
| 8 | Dark mode Week view | Light and dark, Day, Week and Month |

Use Android device frames and Material styling (don't reuse iPhone frames on Play, and never show Android frames on the App Store, Guideline 2.3.10).

### Tablet screenshots

Skip for 1.0 if the app isn't optimized for tablets.

## Release notes for 1.0 (500 characters max on Play)

```
Welcome to Tickler 1.0: Day, Week and Month timelines for everything your AI agents plan, origin links back to each chat or session, Projects, Important, QR pairing with your own server, offline setup guides, local reminders, demo mode, and Tickler Pro with Money, budgets, forecasts, widgets and multiple servers.
```
