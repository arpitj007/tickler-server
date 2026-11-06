# App Store

Shows proceeds, units, new subscriptions, renewals, trials, refunds and cancellations for your
apps on the Apple App Store.

- **Live feed (seconds):** App Store Server Notifications V2 sent to your server.
- **Reports (about 1 day behind):** Sales and Trends daily summary reports, pulled every 6 hours.
  Apple posts each Pacific-time day the next morning (generally by 8 a.m. PT). Finance reports
  (monthly, final) are pulled once they appear, early in the next month.

Apple's Sales and Trends amounts are estimates; Finance reports are final.

## What you need

- An Admin in App Store Connect to create the key (only Admins can create team keys).
- About 5 minutes.

## 1. Create a read-only API key

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com) and open **Users and Access**.
2. Open the **Integrations** tab, choose **App Store Connect API** on the left, and make sure
   **Team Keys** is selected.
   ![Step 2: Integrations, App Store Connect API, Team Keys](../assets/providers/app_store-2.png)
3. Click **Generate API Key** (or **+**). Name it `Tickler`.
4. Under **Access**, choose **Finance**. This is the least privileged role that Apple documents
   for both Sales and Trends and Finance reports. It cannot change apps, prices or users.
   ![Step 4: choose the Finance role](../assets/providers/app_store-4.png)
   (A **Sales** role key may be enough for sales reports alone, but Apple does not document
   that for API keys, so Tickler recommends Finance. Verify if you try Sales.)
5. Click **Generate**. Then click **Download API Key** next to the new key. You can download the
   `.p8` file **only once**; keep it safe or revoke the key if it is lost.
6. Copy the **Issuer ID** (top of the page, Copy button) and the **Key ID** (in the key's row).
   ![Step 6: Issuer ID and Key ID](../assets/providers/app_store-6.png)

Individual keys do not work: Apple's Sales and Finance endpoints need a team key.

## 2. Find your vendor number

Open **Payments and Financial Reports**. The vendor number is in the top left, under your
legal entity name.

![Step 7: vendor number](../assets/providers/app_store-7.png)

## 3. Paste into Tickler

On `/setup` (or in the app), open **Money > App Store** and fill in:

| Field | Value |
| --- | --- |
| Issuer ID | from step 6 |
| Key ID | from step 6 |
| Private key | the whole contents of the `.p8` file, including the BEGIN and END lines |
| Vendor number | from step 2 |
| Bundle ID (optional) | e.g. `com.example.app`, to accept notifications for this app only |
| Record sandbox notifications (optional) | `true` only while testing |

Click **Test**. "Connected" means the key can read reports.

## 4. Set up the live feed (Server Notifications V2)

Needs a public URL (see the Tunnel guide if you run Docker).

1. In App Store Connect, open **Apps**, choose your app, then **App Information** (under General).
2. Scroll to **App Store Server Notifications**.
3. Under **Production Server URL**, click **Set Up URL**, enter
   `https://<your-server>/hooks/app_store`, choose **Version 2**, and save.
   ![Step 3: Production Server URL, Version 2](../assets/providers/app_store-9.png)
4. Optional: set the same URL as **Sandbox Server URL** to test with sandbox purchases (and set
   "Record sandbox notifications" to `true` in Tickler while testing). If you leave Sandbox empty,
   Apple sends sandbox notifications to the production URL; Tickler ignores them by default.

Tickler verifies every notification: the JWS certificate chain must lead to **Apple Root CA - G3**
(embedded in the server), the intermediate and leaf must carry Apple's certificate extensions,
and the signature must match. Anything else gets HTTP 401.

What Tickler records: `SUBSCRIBED` (subscribed, or trial started for free-trial offers),
`DID_RENEW` (renewed), `ONE_TIME_CHARGE` (purchase), `REFUND` (refunded),
`DID_CHANGE_RENEWAL_STATUS` with `AUTO_RENEW_DISABLED` (cancelled), `DID_FAIL_TO_RENEW`
(billing issue). Other types are accepted and ignored.

## Notes

- **Currencies:** Apple reports proceeds in each storefront's currency. Only proceeds in your
  base currency count in totals; the rest are listed separately with a note. The monthly
  Finance report is stored too, per payout currency.
- Units count first downloads and purchases; updates, re-downloads and restores are not units.
- A day with no report after 3 days is recorded as zero sales (Apple only creates a report when
  something sold).

## Troubleshooting

- **HTTP 401 Authentication credentials are missing or invalid:** check the Issuer ID and Key ID,
  and paste the full `.p8` contents. The key may also have been revoked.
- **HTTP 403:** the key's role cannot read reports. Create a key with the Finance role.
- **No numbers yet:** daily reports appear the next day; a brand new account may have none.
- **Webhook returns 401:** the request was not signed by Apple (or the server clock is far off).

## Sources

Checked: 2026-11-06

- https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
- https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
- https://developer.apple.com/documentation/appstoreconnectapi/get-v1-salesreports
- https://developer.apple.com/documentation/appstoreconnectapi/get-v1-financereports
- https://developer.apple.com/support/roles/
- https://developer.apple.com/help/app-store-connect/reference/reporting/summary-sales-report
- https://developer.apple.com/help/app-store-connect/reference/reporting/product-type-identifiers
- https://developer.apple.com/help/app-store-connect/reference/reporting/sales-and-trends-reports-availability
- https://developer.apple.com/help/app-store-connect/reference/reporting/financial-report-fields
- https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications
- https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
- https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
- https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
- https://www.apple.com/certificateauthority/ (Apple Root CA - G3, SHA-256 63:34:3A:BF:...:91:79)
- https://github.com/apple/app-store-server-library-node (leaf certificate OID 1.2.840.113635.100.6.11.1)

## Screenshots needed

- `app_store-2.png`: Users and Access > Integrations > App Store Connect API > Team Keys
- `app_store-4.png`: Generate API Key dialog with the Finance role selected
- `app_store-6.png`: Issuer ID and Key ID on the keys page
- `app_store-7.png`: Payments and Financial Reports with the vendor number
- `app_store-9.png`: App Information > App Store Server Notifications, Production URL, Version 2
