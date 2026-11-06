# Stripe

Shows gross revenue, net proceeds (after Stripe fees and refunds), refunds, charge counts and MRR,
plus a live feed of subscriptions, renewals, trials, refunds and failed payments.

- **Pulled every 15 minutes** from balance transactions and active subscriptions.
- **Live feed (seconds)** from a Stripe webhook.
- Amounts are in your settlement currency, as Stripe converted them. Other settlement currencies
  are shown separately and left out of totals.
- MRR uses list prices of active subscriptions; coupons are not subtracted, metered prices are
  left out.

## 1. Create a restricted, read-only key

1. In the Stripe Dashboard open **Developers > API keys** (`dashboard.stripe.com/apikeys`).
2. Click **Create restricted key**. Name it `Tickler`.
   ![Step 2: Create restricted key](../assets/providers/stripe-2.png)
3. Leave every resource on **None** except these, set to **Read**:
   - **Balance** (balance and balance transactions, permission `balance_read`)
   - **Subscriptions** (`subscription_read`)
   ![Step 3: Balance Read, Subscriptions Read](../assets/providers/stripe-3.png)
4. Click **Create key**, confirm, and copy the key (`rk_live_...`). It is shown once.

Do not use your secret key (`sk_live_...`): it has full access. Tickler warns if you do.
The resource labels in the Dashboard may differ slightly; Stripe names the permissions
`balance_read` and `subscription_read`. If a call is missing a permission, Stripe's error says
which one.

## 2. Paste into Tickler

| Field | Value |
| --- | --- |
| Restricted key | `rk_live_...` |
| Webhook signing secret (optional) | `whsec_...` from step 3 |

Click **Test**: it reads your balance and says live or test mode.

## 3. Add the webhook (live feed)

Needs a public URL.

1. Open **Developers > Webhooks** (Workbench) and click **Create an event destination**
   (or **Add destination**).
2. Choose **Your account**, payload style **Snapshot**, and these events:
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`,
   `charge.refunded`, `checkout.session.completed`.
   ![Step 2: select events](../assets/providers/stripe-6.png)
3. Destination type **Webhook endpoint**, URL `https://<your-server>/hooks/stripe`.
4. Create it, then click **Reveal** next to the signing secret and paste it into Tickler.
   ![Step 4: reveal signing secret](../assets/providers/stripe-8.png)

Tickler checks the `Stripe-Signature` header (HMAC-SHA256 with your signing secret, any of the
`v1` signatures while you roll secrets) and rejects anything older than 5 minutes.

Mapping: subscription created (trial started or subscribed), trial ended into active (subscribed),
cancel at period end turned on (cancelled), deleted without a scheduled cancel (cancelled),
`invoice.paid` for a renewal cycle (renewed), `invoice.payment_failed` (billing issue),
`charge.refunded` (refunded), `checkout.session.completed` in payment mode (purchase). One-off
charges outside Checkout still count in revenue totals, just not in the live feed.

## Troubleshooting

- **HTTP 401 Invalid API Key:** the key was rolled or deleted.
- **HTTP 403 with a permission name:** add Read for that resource on the restricted key.
- **Webhook 401:** the signing secret is wrong (test and live secrets differ), or the server clock
  is more than 5 minutes off.

## Sources

Checked: 2026-11-06

- https://docs.stripe.com/keys/restricted-api-keys
- https://docs.stripe.com/keys/permissions-reference
- https://docs.stripe.com/api/balance_transactions/list
- https://docs.stripe.com/reports/reporting-categories
- https://docs.stripe.com/currencies
- https://docs.stripe.com/api/subscriptions/list
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/events/types
- https://docs.stripe.com/changelog/basil

## Screenshots needed

- `stripe-2.png`: API keys page with Create restricted key
- `stripe-3.png`: restricted key with Balance and Subscriptions on Read
- `stripe-6.png`: event destination event selection
- `stripe-8.png`: destination page with the signing secret revealed
