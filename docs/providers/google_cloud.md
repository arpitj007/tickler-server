# Google Cloud

Shows daily cost by service (after credits) from the Cloud Billing export to BigQuery, and your
budgets (amounts and thresholds) from the Budget API.

- **Pulled every 6 hours.** Google exports costs several hours to a day after usage.
- **Forecast:** the Budget API does not return spend or a forecast (only budget amounts), so
  Tickler uses its 7 day run rate.
- Days are UTC dates of `usage_start_time`. Google's own reports may use Pacific time.
- Each sync runs one small query. BigQuery on-demand pricing gives 1 TiB of queries free per
  month; a small billing export uses a tiny fraction of that.

## 1. Turn on the billing export (once)

**Billing > Billing export > BigQuery export > Standard usage cost > Edit settings**: choose a
project and a dataset (for example `billing`, multi-region US or EU). Google creates the table
`gcp_billing_export_v1_<BILLING_ACCOUNT_ID>` (dashes become underscores). A new multi-region
export backfills from the start of last month within a few days.

![Step 1: billing export settings](../assets/providers/google_cloud-1.png)

## 2. Create a service account with viewer roles

1. **IAM & Admin > Service Accounts > Create service account** in the export's project, name
   `tickler-billing`.
2. Project role: **BigQuery Job User** (`roles/bigquery.jobUser`), so it can run queries. Nothing
   else on the project.
3. In **BigQuery**, open the billing dataset, **Sharing > Permissions > Add principal**: the
   service account with **BigQuery Data Viewer** (`roles/bigquery.dataViewer`) on that dataset
   only.
   ![Step 3: dataset permissions](../assets/providers/google_cloud-4.png)
4. Optional, for budgets: **Billing > Account management > Add principal**: the service account
   with **Billing Account Viewer** (`roles/billing.viewer`). Enable the **Cloud Billing Budget
   API** in the project.
5. **Keys > Add key > Create new key > JSON**. If blocked, your organization enforces
   `iam.disableServiceAccountKeyCreation`; an Org Policy Admin must allow it for this project.

## 3. Paste into Tickler

| Field | Value |
| --- | --- |
| Service account key (JSON) | the whole JSON file |
| Billing export table | `project.dataset.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX` |
| Dataset location (optional) | `US` (default), `EU` or the region |
| Billing account ID (optional) | `XXXXXX-XXXXXX-XXXXXX`, to read budgets |

Click **Test**: it runs a count query for today and lists budgets if configured.

The query (with your table name, start date as a parameter):

```sql
SELECT FORMAT_DATE('%F', DATE(usage_start_time)) AS day, service.description AS service, currency,
  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net
FROM `project.dataset.gcp_billing_export_v1_...`
WHERE usage_start_time >= TIMESTAMP(@start)
GROUP BY day, service, currency
```

## Troubleshooting

- **Access Denied: bigquery.jobs.create:** add BigQuery Job User on the project.
- **Access Denied: table:** add BigQuery Data Viewer on the dataset.
- **Not found: Table:** check the table name and the dataset location.
- **Budgets missing:** add Billing Account Viewer and enable the Budget API. Costs still sync
  without them.

## Sources

Checked: 2026-11-06

- https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup
- https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage
- https://cloud.google.com/billing/docs/how-to/bq-examples
- https://cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets/list
- https://cloud.google.com/billing/docs/how-to/budget-api-access-control
- https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
- https://cloud.google.com/bigquery/pricing
- https://cloud.google.com/iam/docs/keys-create-delete

Verify: the Budget API scope. Google lists `cloud-billing` and `cloud-platform` for
`budgets.list`; Tickler requests `cloud-billing` (IAM still limits the account to viewing).

## Screenshots needed

- `google_cloud-1.png`: Billing export, BigQuery standard usage cost settings
- `google_cloud-4.png`: BigQuery dataset sharing with Data Viewer for the service account
