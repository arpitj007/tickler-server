# Notifications

Tickler can remind you when an entry is due, and tell you when a budget threshold is crossed. Here's exactly how that works, including the honest part.

## What you get

- **Entry reminders:** at each entry's start time. For **important** and **critical** entries, also 15 minutes before.
- **Budget alerts:** when a service crosses 50%, 80% or 100% of the monthly budget you set (you choose the steps).
- **Money alerts:** failed syncs and unusual refund activity (Tickler Pro).

You can turn each kind on or off in **Settings**, then **Notifications**.

## How it works (no server of ours involved)

Tickler has no backend of its own, so it doesn't send pushes from the internet. Instead:

1. Your phone syncs with your own server.
2. After every sync, the app plans reminders **on the phone** for your upcoming entries, using the phone's own notification system.
3. When an agent moves or completes an entry, the next sync updates those reminders.

The phone syncs every time you open the app, and in the background about once an hour. The phone decides the exact time, based on battery and how often you use the app.

## The honest part: alerts can be up to an hour late

- **Entry reminders are on time**, as long as the entry synced to your phone before it was due. Entries your agents add days ahead are always on time.
- **A brand-new entry for the next few minutes** may not alert, if your phone hasn't synced since the agent added it. Opening the app syncs right away.
- **Budget and sales alerts** arrive at the next background sync, so they can be **up to about an hour late**, sometimes more if the phone is in Low Power mode or Battery Saver, or you haven't opened the app for days.

## Making it as reliable as possible

**iPhone:**

- Keep **Background App Refresh** on for Tickler (Settings, then General, then Background App Refresh).
- Allow notifications for Tickler, including **Time Sensitive** if you want critical entries to come through Focus modes.

**Android:**

- Allow notifications for Tickler.
- Allow **alarms and reminders** for Tickler when the app asks, so reminders fire at the exact minute.
- If your phone has aggressive battery saving (common on some brands), set Tickler's battery use to **Unrestricted**.

## Coming later: instant alerts (optional)

A future version (planned for 1.1) adds an **optional** push relay for near-instant alerts. It will be **off by default**. If you turn it on, a tiny service we run sends your phone a contentless "sync now" signal. It will never see titles, amounts or anything from your server, and its code will be public. Until then, nothing leaves your phone or your server.
