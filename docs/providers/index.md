# Money providers

Tickler pulls usage, costs and sales from the services you connect, on your own server. Every
key stays on your server, encrypted. Use a **read-only, least-privilege** key for each one; the
guides below say exactly which screens and permissions.

Honest freshness: only store webhooks are near real time. Everything else is a scheduled pull
with the provider's own delay. Every number in the app shows when it was fetched.

| Provider | Shows | Source | Pull every | Freshness | Webhook | Guide |
| --- | --- | --- | --- | --- | --- | --- |
| App Store | Proceeds, units, subs, trials, refunds, renewals | Sales and Trends + Finance reports, Server Notifications V2 | 6 h | Seconds (webhook) / about 1 day | `/hooks/app_store` | [app_store](app_store.md) |
| Anthropic | Spend and tokens by model | Admin API cost and usage reports | 15 min | About 5 minutes | | [anthropic](anthropic.md) |
| Cloudflare | Workers, D1, R2, KV usage and estimated cost | GraphQL Analytics API + dated price table | 15 min | Minutes | | [cloudflare](cloudflare.md) |
| Stripe | Revenue, net, refunds, MRR | Balance transactions, subscriptions, webhooks | 15 min | Seconds (webhook) / 15 min | `/hooks/stripe` | [stripe](stripe.md) |
| Google Play | Sales, units, subs, refunds, earnings | Play Console reports bucket, RTDN via Pub/Sub | 6 h | Seconds (webhook) / about 1 day | `/hooks/google_play` | [google_play](google_play.md) |
| Amazon Appstore | Sales, earnings, subs | Reporting API, Real-Time Notifications (SNS) | 6 h | Seconds (webhook) / 1 to 2 days | `/hooks/amazon_appstore` | [amazon_appstore](amazon_appstore.md) |
| AWS | Cost by service, forecast | Cost Explorer | 6 h | About 1 day | | [aws](aws.md) |
| Google Cloud | Cost by service, budgets | BigQuery billing export, Budget API | 6 h | Hours to 1 day | | [google_cloud](google_cloud.md) |
| OpenAI | Spend and tokens | Organization costs and usage API | 1 h | About 1 hour | | [openai](openai.md) |
| GitHub | Actions, Copilot, storage, seats | Billing usage API | 1 h | About 1 day | | [github](github.md) |
| Manual | Anything, fixed costs | `POST /api/metrics`, fixed costs in the app | Push | When you send it | | [manual](manual.md) |

## How the numbers add up

- **Revenue** is what you are paid where the source reports it (proceeds or net), otherwise the
  sales amount the source reports (Google Play daily sales are before Google's fee).
- **Costs** are the provider's own cost numbers. Cloudflare is an estimate from usage and a
  dated price table.
- **Fixed costs** count in the month they are charged: monthly ones every month, yearly ones in
  their renewal month. They appear under "Manual".
- **Currency:** totals are in your base currency (`TICKLER_CURRENCY`, default USD). Amounts in
  other currencies are shown separately and left out of totals, with a note, because v1 has no
  exchange rates.
- **Forecast:** the provider's own forecast when it has one (AWS; Cloudflare's is usage run rate
  priced with the table), otherwise month to date plus the average of the last 7 complete days
  times the days left (UTC). The detail screen shows which method was used.

## Webhooks need a public URL

Store webhooks are sent to `https://<your-server>/hooks/<store>`. On Cloudflare Workers the URL
is public already. On Docker, set up a tunnel first (see the Tunnel guide); the provider card
says "Needs a public URL" until one works.

## Connecting from your computer

Keys that come as files (an App Store `.p8`, a Google service account JSON) are easier to add
from a computer than to paste on a phone. From a `tickler-server` checkout:

```sh
cat > creds.json <<'JSON'
{ "issuer_id": "…", "key_id": "…", "private_key": "@AuthKey_ABC123.p8", "vendor_number": "…" }
JSON
TICKLER_SECRET=<your server secret> npm run provider -- set app_store creds.json
rm creds.json
```

- The field names are the ones the app shows for that source. A value starting with `@` is read
  from that file.
- The command tests the key against the provider first and stops if the test fails.
- It encrypts the key with your `TICKLER_SECRET`, the same way the server does, and writes it to
  your Cloudflare D1 database (`--d1 <name>` if yours isn't called `tickler`) or, with
  `--db /path/to/tickler.sqlite`, to a Docker server's file.
- `npm run provider -- test <source> creds.json` only runs the test.
