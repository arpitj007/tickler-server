# Google Play

Shows daily sales and units (estimated sales report), last month's earnings after Google's fees,
and a live feed of purchases, subscriptions, renewals, cancellations, refunds and billing issues.

- **Reports, pulled every 6 hours:** the estimated sales report in your Play Console Cloud Storage
  bucket (low latency, about a day) and the monthly earnings report (by about the 5th of the next
  month).
- **Live feed (seconds):** real-time developer notifications (RTDN) through Pub/Sub push.
- Daily sales are item prices before tax and **before Google's fee**, in the buyer's currency.
  Only your base currency counts in totals. Earnings (after fees, in your payout currency) are
  stored per month.

## 1. Create a service account and key

1. In the [Google Cloud console](https://console.cloud.google.com), pick (or create) a project,
   open **IAM & Admin > Service Accounts**, click **Create service account**, name it
   `tickler-play`. Grant it **no** project roles. Click **Done**.
   ![Step 1: create service account](../assets/providers/google_play-1.png)
2. Open the account, **Keys > Add key > Create new key > JSON**. The file downloads once.
   If key creation is blocked, your organization enforces `iam.disableServiceAccountKeyCreation`
   (default for organizations created since May 2024); an Org Policy Admin must allow keys for
   this project.
3. In the same project, enable the **Google Play Android Developer API** (APIs & Services >
   Library). It is used only to look up the product of a subscription notification.

## 2. Give it read access in Play Console

1. In [Play Console](https://play.google.com/console), open **Users and permissions** and click
   **Invite new users**.
2. Enter the service account email (`tickler-play@<project>.iam.gserviceaccount.com`).
3. Under **Account permissions**, tick only **View financial data, orders, and cancellation
   survey responses**. Bucket reports need this permission at account level.
   ![Step 3: account permission View financial data](../assets/providers/google_play-5.png)
4. Click **Invite user**. New permissions can take up to a day to work.

## 3. Copy the reports bucket URI

Play Console, **Download reports > Financial**, then **Copy Cloud Storage URI**. It looks like
`gs://pubsite_prod_rev_01234567890987654321/sales`.

![Step 4: Copy Cloud Storage URI](../assets/providers/google_play-7.png)

## 4. Paste into Tickler

| Field | Value |
| --- | --- |
| Service account key (JSON) | the whole downloaded JSON file |
| Cloud Storage URI | from step 3 (any path after the bucket name is ignored) |
| Package name (optional) | e.g. `com.example.app` to count one app only |
| Push audience | for notifications, see below |
| Push service account email | for notifications, see below |

Click **Test**: it lists one file in the bucket.

## 5. Real-time notifications (live feed)

Needs a public URL.

1. In Google Cloud, **Pub/Sub > Topics > Create topic**, e.g. `play-rtdn`. On the topic, add the
   principal `google-play-developer-notifications@system.gserviceaccount.com` with the role
   **Pub/Sub Publisher**.
2. Create a second service account, e.g. `tickler-push`, with no roles. It only signs push
   requests.
3. **Pub/Sub > Subscriptions > Create subscription** on the topic: delivery type **Push**,
   endpoint `https://<your-server>/hooks/google_play`, tick **Enable authentication**, choose
   `tickler-push`, and set **Audience** to the same endpoint URL. If asked, grant the Pub/Sub
   service agent the Token Creator role.
   ![Step 3: push subscription with authentication](../assets/providers/google_play-11.png)
4. In Play Console, open your app, **Monetize > Monetization setup**, paste the full topic name
   (`projects/<project>/topics/play-rtdn`), enable notifications (include one-time products if you
   sell them), save, and **Send test notification**.
5. In Tickler set **Push audience** to the endpoint URL and **Push service account email** to the
   `tickler-push` email.

Tickler verifies each push: Google-signed OIDC token, issuer `accounts.google.com`, your audience,
and the push service account email. Anything else gets HTTP 401.

Mapping: purchased (subscribed, or trial started when the Publisher API reports a free trial
phase), renewed and recovered (renewed), canceled (cancelled), on hold and grace period (billing
issue), revoked and voided purchases (refunded), one-time purchase (purchase). Prices are not in
notifications; they come from the reports.

## Troubleshooting

- **HTTP 403 on the bucket:** the account permission is missing or not yet active (wait up to 24 h).
- **"not valid JSON":** paste the whole key file, braces included.
- **No sales today:** the estimated sales report is updated with some delay; earnings arrive monthly.
- **Webhook 401:** audience or service account email differ from the subscription settings.

## Sources

Checked: 2026-11-06

- https://support.google.com/googleplay/android-developer/answer/6135870 (reports and bucket)
- https://support.google.com/googleplay/android-developer/answer/9844686 (permissions)
- https://developers.google.com/android-publisher/getting_started
- https://developer.android.com/google/play/billing/rtdn-reference
- https://developer.android.com/google/play/billing/getting-ready#configure-rtdn
- https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
- https://cloud.google.com/pubsub/docs/push
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://cloud.google.com/storage/docs/json_api/v1/objects/list
- https://cloud.google.com/iam/docs/keys-create-delete

Verify: real CSV headers have varied over time ("Product id" vs "Package ID", date formats);
Tickler matches by name, case-insensitively, with aliases. The free-trial detection uses
`lineItems[].offerPhase.freeTrial` from `purchases.subscriptionsv2`, which should be checked
against a real trial notification.

## Screenshots needed

- `google_play-1.png`: Create service account
- `google_play-5.png`: Play Console invite user with the financial data permission
- `google_play-7.png`: Download reports > Financial > Copy Cloud Storage URI
- `google_play-11.png`: Pub/Sub push subscription with authentication and audience
