# AWS

Shows daily cost by service (unblended) and AWS's own month-end forecast, from Cost Explorer.

- **Pulled every 6 hours.** Cost Explorer refreshes at least once a day, so numbers are about a
  day behind.
- **Every Cost Explorer request costs USD 0.01.** A sync makes 2 requests (costs and forecast),
  more if results span several pages. At 4 syncs a day that is about USD 0.08 a day, roughly
  USD 2.40 a month. Pressing **Test** makes one request (USD 0.01).
- **Forecast:** AWS's `GetCostForecast` for the rest of the month plus what was spent before
  today. New accounts without enough history get Tickler's 7 day run rate instead.

## 1. Turn on Cost Explorer (once)

As the root user or an admin: **Billing and Cost Management > Cost Explorer > Launch Cost
Explorer**. Data for the current month appears within about 24 hours. In an AWS Organization,
member accounts need the management account to allow Cost Explorer for them.

## 2. Create an IAM user with only two actions

1. **IAM > Users > Create user**, name `tickler-cost-read`. Leave console access off.
   ![Step 1: create user](../assets/providers/aws-1.png)
2. Skip attaching policies, create the user, open it, then **Permissions > Add permissions >
   Create inline policy**, JSON tab, and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage", "ce:GetCostForecast"],
      "Resource": "*"
    }
  ]
}
```

   Name it `TicklerCostExplorerRead` and create it.
   ![Step 2: inline policy JSON](../assets/providers/aws-3.png)
3. **Security credentials > Access keys > Create access key**. Choose **Application running
   outside AWS** (or **Other**), create, and copy the access key ID and secret (shown once).
   ![Step 3: create access key](../assets/providers/aws-5.png)

The key can read cost data and nothing else.

## 3. Paste into Tickler

| Field | Value |
| --- | --- |
| Access key ID | `AKIA...` |
| Secret access key | the secret from step 3 |

Requests go to `https://ce.us-east-1.amazonaws.com` (Cost Explorer's only endpoint), signed with
Signature Version 4.

## Troubleshooting

- **AccessDeniedException:** check the inline policy. If the policy is right and it still fails,
  the root user may need to turn on **IAM user and role access to Billing information** (Account
  settings). AWS documents that switch for the console; verify whether your account needs it
  for the API.
- **DataUnavailableException on forecast:** not enough history yet; Tickler uses the run rate.
- **SignatureDoesNotMatch / RequestExpired:** the secret is wrong or the server clock is off by
  more than 15 minutes.

## Sources

Checked: 2026-11-06

- https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html
- https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostForecast.html
- https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/
- https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html
- https://docs.aws.amazon.com/cost-management/latest/userguide/ce-access.html
- https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api-best-practices.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html

## Screenshots needed

- `aws-1.png`: IAM create user, console access off
- `aws-3.png`: inline policy JSON editor with the policy above
- `aws-5.png`: create access key use case selection
