# Privacy policy

**Effective:** [DATE OF FIRST RELEASE]. Applies to the Tickler apps for iPhone and Android, the Tickler server software, and this website.

**Who we are:** Tickler is made by [OWNER LEGAL NAME] ("we"). Contact: privacy@gettickler.com.

## The short version

**We don't collect any data.** Not your entries, not your keys, not your numbers, not analytics, not even an email address. There is no Tickler account.

Tickler is **self-hosted**: you run your own Tickler server (in your own Cloudflare account, or with Docker on your own machine), and the app talks only to that server. We don't run any server that receives, stores or sees your data.

## How Tickler works, and where your data goes

1. **Your server.** You deploy the open-source Tickler server yourself. It stores your entries, projects, origins (where entries came from), money numbers, and any provider keys you add. It runs in an account or on a machine that you control. We have no access to it.
2. **The apps.** The Tickler app on your iPhone or Android phone connects directly to your server over HTTPS, using an address you give it and a token your server issues. It keeps a copy of your synced data on the phone so it works offline.
3. **Your AI tools.** AI tools you connect (like Claude Code, Cursor or ChatGPT) send entries directly to your server. What those tools do with your conversations is covered by their own privacy policies.
4. **Money sources.** If you connect services like the App Store, Stripe or AWS, **your server** contacts them directly using read-only keys you create. The data goes from them to your server, then to your phone. Never to us.

Because all of this happens between your devices, your server and services you choose, we are not a party to it and cannot see it.

## What the apps do on your phone

- **Stored on your phone:** your server's address, the phone's token (in the iPhone Keychain or Android secure storage), and a copy of your synced entries and numbers. You can remove all of it with **Settings, then Disconnect and erase**, or by deleting the app.
- **Camera:** used only to scan the pairing QR code. Images are not saved or sent anywhere.
- **Notifications:** planned and shown by your phone itself, from entries on your phone. No notification content passes through us.
- **Demo mode:** uses sample data built into the app. Nothing is sent anywhere.
- **No analytics, no ads, no tracking, no third-party SDKs.** The apps contain no code that reports what you do.

## Purchases

Tickler Pro is sold through Apple's App Store and Google Play. Apple and Google process the payment under their own privacy policies. We don't receive your name, email or payment details. The stores give developers sales reports (for example, totals by country and product), which don't identify you. The app checks your purchase on the phone with the store's own system.

## Crash reports

We don't include any crash reporting in the apps. If you have chosen to share analytics with Apple (iPhone) or usage and diagnostics with Google (Android), Apple or Google may share anonymous crash reports and performance data with developers. You control this in your phone's settings, under Apple's and Google's policies.

## The website

This documentation website is a static site. We don't use analytics, cookies or tracking on it. Our hosting provider (Cloudflare) processes standard technical data like IP addresses to deliver the pages and protect against attacks, under its own privacy policy. Links to GitHub lead to GitHub's site and policy.

## The review demo server

To let Apple and Google review the apps, we run a demo Tickler server that contains only made-up sample data and is reset every night. It is not used by regular users, and no real user data is ever sent to it.

## App Store and Google Play privacy labels

- **App Store:** Data Not Collected.
- **Google Play Data safety:** No data collected, no data shared. Data the app sends goes to the server you set up, which you control, not to us.

## Future optional push relay (not active)

**This section describes a feature that does not exist yet and is not active.** A future version may offer an optional "push relay" for near-instant alerts, **off by default**. If it ships and you turn it on, it would store only your phone's push notification token and a random relay id, and forward contentless "sync now" signals to your phone. It would never receive entry titles, amounts or anything else from your server, and its source code would be public. Before it ships, we will update this policy and the store privacy labels (a device identifier, not linked to you and not used for tracking), and the app will ask for your explicit opt-in.

## Children

Tickler is a general productivity tool, not directed at children, and collects no data from anyone.

## Your rights

Since we don't hold any personal data about you, there is nothing for us to access, correct, export or delete. All of your Tickler data is on your own server and phone, under your control: export it from **Settings, then Export**, and delete it by removing your server and using **Disconnect and erase**.

## Changes

If this policy changes, we'll update this page and the effective date, and mention it in the app's release notes. We will not start collecting data without changing the store privacy labels and asking you first.

## Contact

privacy@gettickler.com
