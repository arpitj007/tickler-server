# Milestone 0: name, trademark, domain and accounts

Status as of 2026-11-06. "Done" means checked by search; "Owner" means the owner must do it (needs an account, payment or legal judgment).

## Name checks

| Check | Result | Status |
| --- | --- | --- |
| App Store: exact "Tickler" app | No exact match found in US, GB, DE and IN store searches on 2026-11-06, but App Store Connect still refused "Tickler" (names are reserved worldwide, including by unreleased apps) | Done (search) |
| App Store Connect name reservation | Done 2026-11-06: "Tickler" was taken, so the record is **Tickler: Agent Follow-ups** (app id 6831500007, bundle id `com.gettickler.tickler`). The name under the icon stays "Tickler". | Done |
| Google Play: exact "Tickler" app | Search Play for "Tickler" and check for conflicts; reserve the package name `com.<you>.tickler` by creating the app in the Play Console | **Owner** |
| USPTO, classes 9 and 42 | Aggregators show no live TICKLER mark in class 9 or 42 | Done (aggregators), confirm in USPTO search |
| USPTO, related marks | TICKLER, serial 77205084, class 38: dead. POWER TICKLER: cancelled 2001. CPA TICKLER: abandoned. | Done |
| USPTO, to verify | SHOT TICKLER SYSTEM and CLIENTTICKLER: status unknown, check in USPTO trademark search (https://tmsearch.uspto.gov) | **Owner** |
| EUIPO, classes 9 and 42 | Search "Tickler" in eSearch plus / TMview (https://www.tmdn.org/tmview) | **Owner** |
| Other markets (UK IPO, WIPO Global Brand Database) | Optional but cheap to check: https://branddb.wipo.int | **Owner** |

If "Tickler" fails, fall back in this order and re-run every check: **Docket Agent**, **Laterbook**, **Promptly Later**.

Not legal advice: for a paid product, a short consult with a trademark attorney before launch is cheap insurance.

## Domains

| Domain | Status on 2026-11-06 |
| --- | --- |
| gettickler.com | **Available**. Recommended: buy it. |
| tickler.dev | Taken |
| tickler.app | Taken |
| tickler.io | Taken |
| ticklerapp.com | Taken |
| tickler.so | Likely free, verify at a registrar |
| gettickler.app | Likely free, verify at a registrar |

Recommendation: buy **gettickler.com** (and optionally gettickler.app to protect it) through Cloudflare Registrar, so DNS, the docs site on Pages and email routing live in one place. Then:

- `docs.gettickler.com`: the docs site (see `docs/reference/hosting-docs.md`). Until then, the Cloudflare Pages default address works and `DOCS_SITE_URL` covers it.
- Email routing (Cloudflare Email Routing, free) for `security@`, `privacy@` and `support@gettickler.com` to the owner's inbox. These addresses are already used in `SECURITY.md`, the privacy policy, the terms and the store listings.

## GitHub

| Item | Status |
| --- | --- |
| Org `tickler` | Taken |
| Org `gettickler` | Free on 2026-11-06. Optional: create it to hold the name, even if repos stay under `arpitj007` for now. |
| Repos | `arpitj007/tickler-server` (public, AGPL-3.0), `arpitj007/tickler-app` (private) |

The docs, Docker image name (`ghcr.io/arpitj007/tickler-server`), Deploy button and MCP Registry namespace (`io.github.arpitj007/tickler`) all assume `arpitj007`. Moving to an org later means updating those; decide before launch.

## Owner's to-do list

Accounts and IDs:

- [ ] Apple Developer Program membership (USD 99 a year). Note the **Team ID**.
- [x] Create the App Store Connect app record (done 2026-11-06 as "Tickler: Agent Follow-ups", app id 6831500007, bundle id `com.gettickler.tickler`). Add the subtitle from `app-store.md`.
- [x] TestFlight build 1.0.0 (2611060706) live for internal testers, iPhone only.
- [ ] Google Play Console developer account (USD 25 once). Personal accounts must run a 14 day closed test with 12 or more testers before production (see `testflight-and-beta.md`). Consider an organization account (needs a D-U-N-S number) to skip that.
- [ ] Create the Play app and reserve the package name.
- [ ] Paid apps agreement (Apple) and payments profile (Google), with tax and banking, before in-app purchases work.

Products:

- [ ] Decide final pricing. Recommendation: USD 2.99 a month, USD 19.99 a year with 7 days free, USD 49.99 lifetime.
- [x] App Store side done 2026-11-06: subscription group "Tickler Pro" with `tickler.pro.monthly` ($2.99) and `tickler.pro.yearly` ($19.99, 7-day free trial), plus non-consumable `tickler.pro.lifetime` ($49.99), Family Sharing on, all Ready to Submit. Still to do on Play.
- [ ] Create the three products in App Store Connect (subscription group "Tickler Pro" plus a non-consumable) and in the Play Console (subscriptions with base plans plus a one-time product). Use the same product ids on both if possible.
- [ ] Turn on Family Sharing for the iOS products.

Domain, email, docs:

- [ ] Buy gettickler.com. Set up email routing for security@, privacy@, support@.
- [ ] Deploy the docs site on Cloudflare Pages (`docs/reference/hosting-docs.md`), attach `docs.gettickler.com`.
- [ ] Fill the placeholders in `docs/privacy.md` and `docs/terms.md`: effective date, legal name, governing law.

Review demo server:

- [ ] A separate Cloudflare account (or a separate Worker and D1 in the owner's account) for the review demo server, with seed data from `seed/` and a nightly reset (cron).
- [ ] A reusable review pairing code (needs server support; see `app-store.md`).
- [ ] Put its URL and code in both stores' review notes.

Brand questions:

- [ ] Email marketing@anthropic.com about "Works with Claude Code and the Claude apps" in store descriptions (see `app-store.md`).
- [ ] Check OpenAI's brand guidelines (https://openai.com/brand/) by hand for "ChatGPT" and "Codex" mentions.

Launch:

- [ ] Read every channel draft in this folder and verify each community's current rules by hand (Reddit pages couldn't be fetched automatically).
- [ ] Write the Show HN post yourself.
- [ ] Write the awesome-selfhosted and awesome-mcp-servers submissions yourself (both lists reject machine-written contributions or ask for them to be marked).
