# Money

The Money tab shows what your apps earn and what your services cost, this month, with a forecast for month end. It's part of Tickler Pro (you can look at it with demo data for free).

All the numbers are fetched by **your own server**, using **read-only** keys that you create and that never leave your server.

## What you see

- **This month:** revenue, costs, net, and the month-end forecast. Each number shows **as of**: when it was last fetched.
- **A card per store** (App Store, Google Play, Amazon Appstore, Stripe): proceeds, units, new subscriptions, renewals, refunds, trials, a 30 day chart, and a live feed of sales.
- **A card per service** (Cloudflare, Google Cloud, AWS, Anthropic, OpenAI, GitHub): month to date, your budget bar, the forecast and the biggest cost lines.
- **Fixed costs** you type in yourself, like developer program fees, domains or hosting. Tickler adds an Important entry 14 days before each renewal.

## How fresh are the numbers?

Every source has its own delay, and Tickler always shows it:

| Source | How fast |
| --- | --- |
| Store sales through webhooks (App Store, Google Play, Amazon, Stripe) | seconds |
| Anthropic, Cloudflare, Stripe balances | every 15 minutes |
| OpenAI, GitHub | hourly |
| App Store and Google Play reports | about a day behind (the stores' own delay) |
| AWS, Google Cloud | a few hours to a day behind |
| Fixed costs and manual numbers | whenever you change them |

Webhooks need your server to have a public address. On Cloudflare that's automatic. On Docker, a provider card shows **Needs a public URL** until you set one up.

## Connecting a source

For each source, the app and the docs site have a step-by-step guide that shows exactly which **read-only** key to create, with the smallest permissions that work. The pattern is always the same:

1. Follow the guide to create a read-only key in the provider's dashboard.
2. Paste the key on your server's setup page under **Money**, or in the app under **Money**, then the provider, then **Connect**. The app sends it straight to your server over HTTPS and keeps no copy.
3. Press **Test**. You see **Connected** or the provider's own error message.

Your server encrypts every key before storing it. The app never stores provider keys.

You'll find the provider guides in the app under **Money**, then a provider, then **Guide**.

## Budgets and alerts

Set a monthly budget for any service, or for all costs together. When spending crosses 50%, 80% and 100% (you can change the steps), Tickler:

- adds an Important entry in a project called **Money** (critical at 100%)
- sends you a notification
- does this only once per step per month, so you don't get the same alert twice

## Forecasts

- If the provider has its own forecast (AWS, Google Cloud), Tickler uses it.
- Otherwise: what you've spent so far this month, plus the average of the last 7 complete days times the days left.

Each detail screen says which method it used.

## Currency

Tickler reports in one currency (US dollars unless you change it on your server). Amounts in another currency are shown separately and left out of totals, unless the provider gives a converted amount.
