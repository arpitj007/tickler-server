# Cloudflare

Shows usage of Workers (requests, CPU time), D1 (rows read and written, storage), R2 (Class A
and B operations, storage) and KV (reads, writes) for one account, and an **estimated** cost.

- **Pulled every 15 minutes** from the GraphQL Analytics API (data is a few minutes behind).
- **Cost is an estimate:** Tickler takes usage beyond the Workers Paid plan's included amounts and
  multiplies it by a dated price table (`src/providers/prices/cloudflare.ts`, prices as of
  2026-11-06), plus the USD 5 base fee on the 1st. Cloudflare bills from your plan's renewal
  date; Tickler uses calendar months, so the split between months can differ from your invoice.
- **Forecast:** each usage line is projected to month end with its 7 day run rate, then priced.

## 1. Create a read-only API token

1. In the Cloudflare dashboard, open **My Profile > API Tokens** (or, for an account-owned token,
   **Manage Account > Account API Tokens**).
   ![Step 1: API Tokens page](../assets/providers/cloudflare-1.png)
2. Click **Create Token**, then **Create Custom Token** (Get started).
3. Name it `Tickler (read analytics)`.
4. Under **Permissions**, add exactly one row: **Account**, **Account Analytics**, **Read**.
   ![Step 4: Account, Account Analytics, Read](../assets/providers/cloudflare-4.png)
5. Under **Account Resources**, choose **Include** and your account only.
6. Optional: client IP filtering (your server's IP) and a TTL.
7. **Continue to summary**, then **Create Token**, and copy it (shown once).

This token can read analytics only. It cannot change Workers, DNS or billing.

## 2. Find your account ID

Open the account home in the dashboard. The account ID is in the URL
(`dash.cloudflare.com/<account id>/...`) and in the **Account details** panel.

![Step 8: account ID](../assets/providers/cloudflare-8.png)

## 3. Paste into Tickler

| Field | Value |
| --- | --- |
| API token | the token from step 7 |
| Account ID | from step 2 |
| Workers plan (optional) | `paid` (default) or `free`. On the free plan the cost is 0. |

Click **Test**: it runs a small analytics query for today.

## Prices used (as of 2026-11-06, Workers Paid)

| Item | Included per month | Beyond that |
| --- | --- | --- |
| Base fee | | USD 5 per month |
| Workers requests | 10 million | USD 0.30 per million |
| Workers CPU time | 30 million ms | USD 0.02 per million ms |
| D1 rows read | 25 billion | USD 0.001 per million |
| D1 rows written | 50 million | USD 1.00 per million |
| D1 storage | 5 GB | USD 0.75 per GB-month |
| R2 Class A operations | 1 million | USD 4.50 per million |
| R2 Class B operations | 10 million | USD 0.36 per million |
| R2 storage (Standard) | 10 GB-month | USD 0.015 per GB-month |
| KV reads | 10 million | USD 0.50 per million |
| KV writes, deletes, lists | 1 million | USD 5.00 per million |

Not included in the estimate: Durable Objects, Queues, Workers AI, Images, Stream, R2 Infrequent
Access, domains and add-ons. Add those as fixed costs or manual metrics.

## Troubleshooting

- **"no analytics could be read":** the token lacks Account Analytics Read, or the account ID is
  wrong.
- **One product missing:** if a dataset query fails (for example R2 not enabled), Tickler skips
  it and keeps the rest; the skipped dataset is noted in the snapshot.
- **Numbers differ from the invoice:** see the calendar month note above, and check the price
  table date.

## Sources

Checked: 2026-11-06

- https://developers.cloudflare.com/analytics/graphql-api/
- https://developers.cloudflare.com/analytics/graphql-api/limits/
- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
- https://developers.cloudflare.com/d1/observability/metrics-analytics/
- https://developers.cloudflare.com/r2/platform/metrics-analytics/
- https://developers.cloudflare.com/kv/observability/metrics-analytics/
- https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/kv/platform/pricing/

Verify: the docs do not publish the `sum.cpuTimeUs` field of `workersInvocationsAdaptive`, the
`date` dimension on the Workers and R2 datasets, or the exact R2 and KV `actionType` strings.
Tickler uses the names shown by the GraphQL schema as of the check date; check them with the
GraphQL explorer if a product shows no usage. Unknown R2 operation names count as Class A.

## Screenshots needed

- `cloudflare-1.png`: My Profile > API Tokens
- `cloudflare-4.png`: custom token permissions row Account / Account Analytics / Read
- `cloudflare-8.png`: account home with the account ID
