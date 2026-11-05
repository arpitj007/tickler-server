# Security and threat model

Tickler is built so that the people who make it **never** hold your data. This page explains what's protected, how, and what isn't covered, so you can decide for yourself.

To report a vulnerability, see [Reporting a problem](#reporting-a-problem) below.

## The short version

- Your entries, projects, origins, provider keys and money numbers live on **your** server and **your** phone. Nothing goes to us. We run no backend that stores user data.
- Every client (phone, AI tool) gets its own token. Only a hash of each token is stored. Any of them can be revoked on its own.
- Provider keys are encrypted on your server and are **read-only** keys you create.
- Store webhooks are verified before anything is recorded.

## What's where

| Data | Where it lives | Protection |
| --- | --- | --- |
| Entries, projects, origins, activity | Your server's database (D1 on Cloudflare, a SQLite file on Docker) | Only reachable with a valid token |
| Provider keys (Stripe, AWS, ...) | Your server's database | Encrypted with AES-GCM, using a key derived from `TICKLER_SECRET`. Never sent to the app or returned by the API. |
| Token for each phone and AI tool | Your server stores a SHA-256 hash only | The plain token is shown once |
| Admin login | Your server | Passkey (WebAuthn) or a passphrase |
| The phone's own token | iPhone Keychain or Android Keystore-backed storage | Never in backups in plain text |
| Synced entries and numbers on the phone | The app's local database | iPhone file protection "complete"; Android app-private storage |

The app never stores provider keys. When you paste one in the app, it goes straight to your server over HTTPS.

## Who can do what

| Caller | How it proves itself | What it can reach |
| --- | --- | --- |
| A paired phone | Device token (`tkd_...`) | The app API (`/api/*`) |
| An AI tool with a token | MCP token (`tkm_...`) | `/mcp`, and posting manual metrics |
| An AI tool through OAuth | Access token issued by your server after you log in and press Allow | `/mcp` only |
| You in a browser | Passkey or passphrase on `/setup` | Setup: pairing, tokens, provider keys |
| A store (Apple, Google, Amazon, Stripe) | Signed webhook, verified | Records sales events only |

## Protections in the server

- **Webhook signatures are always checked:** Apple's signed payloads against Apple's root certificates, Google's push token, Amazon's message signature and Stripe's signing secret. Unverified calls are rejected.
- **Rate limits** on `/setup`, `/oauth` and `/mcp`, and 60 writes a minute per AI token.
- **Pairing codes** are single use, expire after 10 minutes, and repeated wrong guesses are slowed down.
- **CORS is locked**, so random websites can't call your server from your browser.
- **Every write is logged** with who made it (device, token or OAuth client) and which origin.
- **Revoke anything** from `/setup` or the app: phones, MCP tokens, OAuth clients.

## Threat model

### What Tickler protects against

| Threat | Protection |
| --- | --- |
| The makers of Tickler, or anyone who hacks them, reading your data | There is nothing to read: we don't run a backend with user data. The app talks only to your server. |
| A stolen or lost phone | Revoke its device token on `/setup`. On the phone, data sits in OS-protected storage behind your passcode. |
| A leaked MCP token (pasted in a repo, a screenshot) | Revoke that one token; others keep working. A token can't read provider keys or change setup. |
| Someone finding your server's address | Everything except health and pairing needs a token. Pairing needs a fresh code that only you can create. |
| A fake webhook adding false sales | Signatures are verified; unverified calls are dropped. |
| A copied database file | Provider keys inside it are encrypted; tokens are only hashes. |
| An agent creating spam entries | 60 writes a minute per token, and the activity log shows which token and session did it. |

### What it doesn't protect against

Be aware of these:

- **Your hosting account.** Whoever controls your Cloudflare account, or the machine running Docker, controls your Tickler data and `TICKLER_SECRET`. Protect those accounts with strong passwords and two-factor login.
- **Your AI tools.** An AI tool you connect can create, change and complete entries, and read your entries and money summary. A connected tool that is tricked by a malicious web page or file (prompt injection) could do the same. Connect tools you trust, and revoke tokens you no longer use.
- **Entry contents are not end-to-end encrypted.** Your server stores entries in readable form so it can search and sort them. That's fine because it's your server, but it means server access equals data access.
- **Your provider keys' own permissions.** Tickler's guides tell you to create read-only keys with the smallest permissions. If you paste a key with more power, a compromised server could misuse it.
- **Webhook payloads from stores** contain product ids, prices and countries of purchases, but no buyer names or emails.
- **Old Docker images.** Keep your server updated; see [updating](/guides/deploy-docker#updating).

## Things we will never do

- Add analytics, ads or third-party tracking SDKs to the apps.
- Collect your entries, keys or numbers.
- Require an account with us.

The only planned exception is an **optional** push relay (planned for v1.1, off by default) that would see your phone's push token and a random id, and nothing else. See [Privacy](/privacy#future-optional-push-relay-not-active).

## Reporting a problem

Please report security issues privately to **security@gettickler.com**, not in public issues. See [SECURITY.md](https://github.com/arpitj007/tickler-server/blob/main/SECURITY.md) for what to include and what to expect.
