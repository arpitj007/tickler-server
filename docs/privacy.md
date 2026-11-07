# Privacy policy

**Effective:** [DATE OF FIRST RELEASE]. Applies to the Tickler apps for iPhone and Android, the Tickler server software, Tickler Cloud, and this website.

**Who we are:** Tickler is made by [OWNER LEGAL NAME] ("we"). Contact: privacy@gettickler.com.

## The short version

Tickler works two ways, and what we see depends on which one you choose:

- **Self-hosted (your own server):** **we don't collect any data.** Not your entries, not your keys, not your numbers, not analytics, not even an email address. There is no Tickler account. You run your own Tickler server (in your own Cloudflare account, or with Docker on your own machine), and the app talks only to that server.
- **Tickler Cloud (we host your server):** we run a private Tickler server for you, so **we store your Tickler data on your behalf**, plus the minimum needed for your account and subscription. We use it only to run your server. No analytics, no ads, no tracking, and we never sell it. Details in [Tickler Cloud](#tickler-cloud) below.

In both cases the apps contain no analytics, advertising or tracking code.

## Self-hosted: how Tickler works, and where your data goes

1. **Your server.** You deploy the open-source Tickler server yourself. It stores your entries, projects, origins (where entries came from), money numbers, and any provider keys you add. It runs in an account or on a machine that you control. We have no access to it.
2. **The apps.** The Tickler app on your iPhone or Android phone connects directly to your server over HTTPS, using an address you give it and a token your server issues. It keeps a copy of your synced data on the phone so it works offline.
3. **Your AI tools.** AI tools you connect (like Claude Code, Cursor or ChatGPT) send entries directly to your server. What those tools do with your conversations is covered by their own privacy policies.
4. **Money sources.** If you connect services like the App Store, Stripe or AWS, **your server** contacts them directly using read-only keys you create. The data goes from them to your server, then to your phone. Never to us.

Because all of this happens between your devices, your server and services you choose, we are not a party to it and cannot see it.

## Tickler Cloud

Tickler Cloud is an optional paid subscription where we host a Tickler server for you, so you don't have to set one up. Each Cloud customer gets their own separate server and database.

**What we store, and why:**

| Data | Why |
| --- | --- |
| Your Sign in with Apple user id, and the email address Apple gives us (often a private relay address) | To know which account is yours, and to contact you about your account or a problem with your server |
| Your subscription status, plan, renewal date and Apple transaction ids | To know whether your server should be running, read-only or deleted |
| Everything you or your AI tools put on your Tickler server: entries, projects, origins, money numbers, budgets, and the provider keys you add | This is your server: storing it is the service |
| Paired phones, connected AI tools and the activity log of your server | So you can see and revoke what has access |
| Standard technical data (IP addresses, request logs) processed by Cloudflare | To deliver the service and protect it against attacks |

**Where it lives:** on Cloudflare (Workers, Durable Objects and D1), which processes it for us under its own terms and security. Data is encrypted at rest by Cloudflare. Provider keys are additionally encrypted with a key unique to your server.

**Who can see it:** your server is private to you and the phones and AI tools you connect. We don't look at your data. We could technically access it, and would only do so to keep your server running or fix a problem you ask us to help with, to protect the service from abuse, or when the law requires it.

**What we don't do:** no analytics, no advertising, no tracking, no selling or sharing your data, and no training of AI models on it.

**How long we keep it:**

- While your subscription is active (including Apple's billing grace period), your server runs normally.
- If your subscription ends, your server becomes read-only for 30 days so you can export your data or move to your own server, then it is deleted.
- If you delete your account in the app (**Settings, then Delete account**), your account and server are deleted right away, and we revoke Tickler's Sign in with Apple access. Cloudflare's point-in-time recovery may keep encrypted copies for up to 30 more days before they are gone for good.

**Your choices:** export everything as JSON at any time (**Settings, then Export data**), move to your own self-hosted server (**Move to my own server**), or delete your account. Deleting the app does not cancel the subscription: cancel it in your App Store settings.

## What the apps do on your phone

- **Stored on your phone:** your server's address, the phone's token (in the iPhone Keychain or Android secure storage), and a copy of your synced entries and numbers. You can remove all of it with **Settings, then Disconnect and erase**, or by deleting the app.
- **Camera:** used only to scan the pairing QR code. Images are not saved or sent anywhere.
- **Notifications:** planned and shown by your phone itself, from entries on your phone. No notification content passes through us.
- **Demo mode:** uses sample data built into the app. Nothing is sent anywhere.
- **No analytics, no ads, no tracking, no third-party SDKs.** The apps contain no code that reports what you do.

## Purchases

Tickler Pro and Tickler Cloud are sold through Apple's App Store (and, for Pro, Google Play). Apple and Google process the payment under their own privacy policies. We never receive your payment details. The stores give developers sales reports (for example, totals by country and product), which don't identify you.

- **Tickler Pro:** the app checks your purchase on the phone with the store's own system. We don't receive your name or email.
- **Tickler Cloud:** the app sends us Apple's signed record of your subscription, tagged with your Cloud account id, and Apple notifies us of renewals, cancellations and refunds, so we know whether to keep your server running. These records contain no payment details.

## Crash reports

We don't include any crash reporting in the apps. If you have chosen to share analytics with Apple (iPhone) or usage and diagnostics with Google (Android), Apple or Google may share anonymous crash reports and performance data with developers. You control this in your phone's settings, under Apple's and Google's policies.

## The website

This documentation website is a static site. We don't use analytics, cookies or tracking on it. Our hosting provider (Cloudflare) processes standard technical data like IP addresses to deliver the pages and protect against attacks, under its own privacy policy. Links to GitHub lead to GitHub's site and policy.

## The review demo server

To let Apple and Google review the apps, we run a demo Tickler server that contains only made-up sample data and is reset every night. It is not used by regular users, and no real user data is ever sent to it.

## App Store and Google Play privacy labels

- **Self-hosted use collects nothing.** Data the app sends goes to the server you set up, which you control, not to us.
- **Tickler Cloud** (once it is available in the app): the App Store label lists, as linked to you and used only for app functionality, never for tracking: Contact Info (email address), User Content (your entries and other content), Identifiers (user id) and Purchases (purchase history).
- **Google Play Data safety:** No data collected, no data shared, until Tickler Cloud is offered on Android.

## Future optional push relay (not active)

**This section describes a feature that does not exist yet and is not active.** A future version may offer an optional "push relay" for near-instant alerts, **off by default**. If it ships and you turn it on, it would store only your phone's push notification token and a random relay id, and forward contentless "sync now" signals to your phone. It would never receive entry titles, amounts or anything else from your server, and its source code would be public. Before it ships, we will update this policy and the store privacy labels (a device identifier, not linked to you and not used for tracking), and the app will ask for your explicit opt-in.

## Children

Tickler is a general productivity tool, not directed at children. Tickler Cloud is not intended for children under 13 (or the minimum age in your country).

## Your rights

- **Self-hosted:** we don't hold any personal data about you, so there is nothing for us to access, correct, export or delete. All of your Tickler data is on your own server and phone, under your control: export it from **Settings, then Export**, and delete it by removing your server and using **Disconnect and erase**.
- **Tickler Cloud:** you can access and export your data in the app at any time and delete your account there. For anything else (for example, a question about what we hold), email privacy@gettickler.com. Depending on where you live (for example, under the GDPR or CCPA), you may have further rights, such as to object or to complain to a data protection authority.

## Changes

If this policy changes, we'll update this page and the effective date, and mention it in the app's release notes. We will not start collecting new kinds of data without changing the store privacy labels and asking you first.

## Contact

privacy@gettickler.com
