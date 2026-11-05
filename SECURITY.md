# Security policy

Thank you for helping keep Tickler and its users safe.

## Reporting a vulnerability

Email **security@gettickler.com**. Please don't open a public issue or discussion for security problems.

If you prefer, use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**.

Please include:

- what's affected (server version from `/api/health`, runtime: Cloudflare Workers or Docker, app version and platform)
- steps to reproduce, or a proof of concept
- the impact as you understand it
- whether you'd like to be credited, and how

**Never send real tokens, passphrases or provider keys**, yours or anyone else's.

## What to expect

- An acknowledgement within 3 working days.
- A first assessment within 10 working days.
- A fix or mitigation for confirmed issues as fast as severity requires. Critical issues get a patch release and a GitHub Security Advisory.
- Credit in the advisory and release notes, if you want it.

Please give us a reasonable time to ship a fix (normally up to 90 days) before disclosing publicly. We won't take legal action against good-faith research that follows this policy, avoids privacy violations and service disruption, and only uses servers and accounts you own.

## Supported versions

Tickler is self-hosted, so fixes only reach you when you update.

| Component | Supported |
| --- | --- |
| Server: latest minor release (`0.x` before 1.0, then `1.x`) | Yes |
| Server: older releases | No, please update |
| iPhone and Android apps: current store version | Yes |
| iPhone and Android apps: older versions | No, please update |

## In scope

- The server in this repository: `/mcp`, `/api/*`, `/setup`, `/oauth/*`, `/hooks/*`, the scheduler, storage and encryption of provider keys, on both Cloudflare Workers and Docker
- The Claude Code origin hook in `hooks/`
- The official Docker image `ghcr.io/arpitj007/tickler-server`
- The Deploy to Cloudflare configuration
- The Tickler iPhone and Android apps (token storage, pairing, deep links, local data)
- The optional push relay, once it exists (`relay/`)

Examples of what we care about: authentication or token bypass, reading another device's or token's data, pairing code weaknesses, OAuth flow flaws, webhook signature bypass, provider key exposure, injection, CORS mistakes, and deep links that act without the user's intent.

## Out of scope

- Your own hosting account security (Cloudflare, your Docker host, your router)
- Vulnerabilities in Cloudflare, Docker, Tailscale or third-party providers themselves (report those to them)
- Attacks that need an already-compromised device or admin session
- An AI tool you connected doing what its token allows (see the threat model in the docs)
- Rate limit tuning, missing security headers without a demonstrated impact, and reports from automated scanners without a working proof
- The review demo server, which holds only fake data (please don't attack it; tell us if you find an issue)
- Social engineering of the maintainers

## How Tickler is designed

See the security and threat model page in the docs: `docs/security.md`, published at https://docs.gettickler.com/security.
