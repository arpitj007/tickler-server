# Beta plan: TestFlight and Google Play testing

Goal: 2 to 4 weeks of public beta on both platforms before submitting 1.0. All feedback goes to **GitHub Discussions**, not an analytics SDK.

## Feedback channel (set up first)

1. Enable Discussions on `arpitj007/tickler-server` (Settings, Features, Discussions).
2. Categories: **Announcements**, **Q&A**, **Ideas**, **Beta feedback**, **Show and tell**.
3. Pin a "Beta feedback: start here" post with: what to test, how to report (platform, app version, server runtime and version from `/api/health`), and a reminder never to post tokens.
4. Add issue templates for bugs (server, iPhone app, Android app).

Every beta build's "What to Test" text links to https://github.com/arpitj007/tickler-server/discussions/categories/beta-feedback (adjust once created).

## iPhone: TestFlight

Status 2026-11-06: build 1.0.0 (2611060706) is live for internal testers, iPhone only. Until gettickler.com is live, the feedback link points to the GitHub repo.

Facts checked 2026-11-06 (https://developer.apple.com/testflight/, https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview):

- Up to 100 internal testers (App Store Connect users) and up to 10,000 external testers.
- External testing needs a **beta app description**, **beta review information** and a **Beta App Review** of the first build in a group. Later builds may not need a full review.
- A **public link** lets anyone join without an email invite. You can cap the number of testers.
- Builds expire after **90 days**.

Plan:

| Week | What |
| --- | --- |
| 0 | Internal testing (owner and 2 to 5 friends): onboarding, pairing, demo mode, notifications. Fix blockers. |
| 1 | Submit the first build for Beta App Review with the same review notes as the App Store (demo server plus demo mode). Create external group "Public beta", public link capped at 500. |
| 1 to 2 | Seed: post the link in the channels below, within their rules. |
| 2 to 3 | Weekly builds. Each build's "What to Test" lists changes and 2 to 3 focus areas. |
| 3 to 4 | Release candidate. Freeze features. Submit 1.0 for App Review. Keep the beta group for 1.1. |

Beta app description (draft):

```
Tickler is the calendar your AI agents write to. Agents (Claude Code, Cursor, Codex and other MCP clients) add follow-ups, deadlines and scheduled runs to your own self-hosted server; the app shows them with links back to the conversation that created them. Try it with demo data, or deploy your own server in about 10 minutes (guides in the app). Feedback: GitHub Discussions, Beta feedback category.
```

Beta "What to Test" for build 1:

```
1. Setup: deploy a server (Cloudflare or Docker), pair by QR, connect one AI tool. Did any step take more than a few minutes or confuse you?
2. Ask your agent to add an entry. How long until it appears on your phone?
3. Demo mode: does any screen look broken?
Report in GitHub Discussions > Beta feedback. Please never post tokens or keys.
```

Note: the TestFlight beta description is shown to testers only, so naming the AI tools there is less sensitive than store metadata. Still keep logos out.

## Android: Google Play testing tracks

Fact checked 2026-11-06 (https://support.google.com/googleplay/android-developer/answer/14151465): **personal developer accounts created after 13 November 2023 must run a closed test with at least 12 testers opted in continuously for 14 days** before they can apply for production access. Organization accounts are exempt.

Plan:

| Step | What |
| --- | --- |
| 1 | Internal testing track (up to 100 testers, no review wait): owner devices. |
| 2 | **Closed testing** track "beta". Testers join with a Google Group (create `tickler-beta@googlegroups.com`) or an email list. Start this as early as possible: the 14 day clock only runs while at least 12 testers stay opted in. Recruit 20 or more to have margin. |
| 3 | After 14 days, apply for production access in the Play Console (answers about the test: what was tested, feedback received, changes made). Keep notes during the test for this. |
| 4 | Optional **open testing** track: anyone can join from the Play listing. Use it after production access as the public beta for 1.1. |

Closed test recruitment message (for the channels below; follow each one's rules):

```
I'm the developer of Tickler, a self-hosted calendar that AI agents (via MCP) write to. I need Android testers for a 14 day closed test on Google Play. You'd join a Google Group, install from Play, and try it with demo data or your own server. Feedback in GitHub Discussions. Link: [GROUP LINK]
```

## Where to find testers (within each community's rules)

- r/ClaudeAI, r/ClaudeCode, r/selfhosted (only in the place and on the day the rules allow), r/iOSapps and r/androidapps (if they allow beta posts; see each draft in this folder).
- MCP community spaces (MCP Discord, GitHub Discussions of MCP projects) where "show your project" posts are welcome.
- The owner's own network.

Always say you're the developer, never offer rewards for reviews or ratings, and don't ask for upvotes.

## Exit criteria for 1.0

- Fresh Cloudflare deploy to first agent entry on the phone in under 10 minutes, by at least 5 testers who are not developers of Tickler.
- No open crash or data-loss bugs.
- Pairing, demo mode and Disconnect and erase verified on both platforms.
- Review demo server stable for 7 days with nightly reset.
