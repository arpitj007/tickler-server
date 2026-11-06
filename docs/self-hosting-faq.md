# Self-hosting FAQ

## How much does it cost to run?

**On Cloudflare: usually nothing.** Tickler fits comfortably in Cloudflare's free Workers plan. The limits that matter (checked 2026-11-06):

| Free plan limit | Amount | What Tickler uses for one person |
| --- | --- | --- |
| Worker requests | 100,000 a day | A few hundred to a few thousand a day: phone syncs, agent calls, scheduled syncs |
| CPU time | 10 ms per request | Normal requests use a few ms |
| Cron triggers | 5 per account | Tickler needs only a few |
| D1 rows read | 5 million a day | Well under |
| D1 rows written | 100,000 a day | Well under |
| D1 storage | 500 MB per database, 5 GB per account | Years of entries fit in a few MB |

If you ever hit a daily limit, requests fail until midnight UTC, then work again. Nothing is lost. If you outgrow it, or want headroom, Cloudflare's paid Workers plan is USD 5 a month per account and covers far more than Tickler will ever need.

Check Cloudflare's current limits: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

**On Docker:** whatever your machine costs to run. Tickler is light: a small Node.js process that is idle most of the time, and a database that stays small. A Raspberry Pi 4 is plenty. A small VPS works too.

**Money sources can cost a little.** AWS charges USD 0.01 per Cost Explorer request; Tickler asks at most every 6 hours, so about USD 1.20 a month if you connect AWS. The other providers' read APIs are free.

## Do I need a domain?

No. On Cloudflare you get a `workers.dev` address. On Docker, Tailscale Funnel gives you a `ts.net` address. A domain is only needed for a permanent Cloudflare Tunnel, or if you want a nicer address.

## Can I put it on a custom domain on Cloudflare?

Yes. In the Cloudflare dashboard, open your Worker, then **Settings**, then **Domains & Routes**, and add a custom domain from a zone in your account. Pair your phone again afterwards, or update the address in the app's server settings.

## How do I update?

- **Cloudflare:** sync your copy of the repo on GitHub with the original. Cloudflare rebuilds automatically. [Details](/guides/deploy-cloudflare#updating-later).
- **Docker:** `docker compose pull && docker compose up -d`. [Details](/guides/deploy-docker#updating).

Database changes run automatically on start. The app tells you if your server is too old for it.

## How do I back up?

- **Docker:** it's one SQLite file. [Backups](/guides/deploy-docker#backups).
- **Cloudflare:** D1 keeps its own point-in-time history (Time Travel) for the last days, so you can roll back. For a copy you keep yourself, export it with Wrangler: `npx wrangler d1 export tickler-db --remote --output tickler-backup.sql`. In the app, **Settings, then Export** also saves everything as JSON.

## Can I move from Cloudflare to Docker, or back?

Yes. Both use the same database schema. Export the D1 database with Wrangler as above and import it into a fresh SQLite file (`sqlite3 data/tickler.sqlite < tickler-backup.sql`) before the first start, or the other way around with `wrangler d1 execute --file`. Use the same `TICKLER_SECRET` on both, or your provider keys need pasting again. Then pair your phone again.

## What settings does the server have?

| Setting | What it does | Default |
| --- | --- | --- |
| `TICKLER_SECRET` | Encrypts provider keys. Required. Keep it safe and the same across updates. | none |
| `TICKLER_PUBLIC_URL` | Your public address, used in QR codes and webhook addresses. | detected from requests |
| `TICKLER_CURRENCY` | Base currency for Money totals and budgets. | `USD` |
| `TICKLER_SERVER_NAME` | The name the app shows for this server, like "Home". You can also set it on `/setup`. | `Tickler` |

## What does the server need to reach on the internet?

Only the services you connect (for example `api.stripe.com`, `api.anthropic.com`) and, on Docker, nothing else. It doesn't phone home, check for updates or send telemetry.

## Is the server code really open?

Yes, AGPL-3.0, at [github.com/arpitj007/tickler-server](https://github.com/arpitj007/tickler-server). You can read every line that touches your data. If you run a modified version as a service for others, the AGPL asks you to share your changes.

## Can I run it on something other than Cloudflare or Docker?

The Docker image runs anywhere containers run: Fly.io, Railway, a Kubernetes cluster, Unraid, Synology, TrueNAS. Give it a persistent volume at `/data` and port 8787. Plain Node.js 20+ works too, from the repo.
