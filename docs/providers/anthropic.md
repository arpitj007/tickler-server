# Anthropic

Shows your Claude API spend per day and per model, and tokens per model, from the Anthropic
Admin API (Usage and Cost API).

- **Pulled every 15 minutes.** Anthropic says data usually appears within 5 minutes of a request.
- Costs are in USD. Priority Tier usage is billed differently and is not in the cost report.

## What you need

- An Anthropic organization (the Admin API is not available on individual accounts).
- The **admin** role in that organization.

## Important: admin keys are not read-only

Anthropic Console admin keys have no scopes: every admin key can call every Admin API endpoint,
including managing members and API keys. There is no read-only option today. To limit the risk:

- create a key used **only** by Tickler, with an **expiration**;
- keep it on your own server only (Tickler stores it encrypted and never sends it to the app);
- revoke it from the Console if anything looks wrong.

Tickler itself only calls the read endpoints listed under Sources.

## 1. Make sure your account is an organization

Admin keys only exist on organization accounts. On an individual account the Admin keys page
doesn't appear (or opens "page not found"), and Anthropic's docs say: "The Admin API is
unavailable for individual accounts."

1. Open the Organization page in the Claude Console:
   [platform.claude.com/settings/organization](https://platform.claude.com/settings/organization).
   (`console.anthropic.com` now redirects to `platform.claude.com`.)
2. If it offers to set up an organization, do it: give it a name (your name or company is fine).
   Your existing API keys, billing and usage stay with it, and you become its admin.
3. If you're already in an organization but don't see Admin keys, ask its owner for the
   **admin** role.

## 2. Create the admin key

1. Open [platform.claude.com/settings/admin-keys](https://platform.claude.com/settings/admin-keys)
   (**Settings > Admin keys** in the Console).
   ![Step 1: Settings, Admin keys](../assets/providers/anthropic-1.png)
2. Click **Create admin key**, name it `Tickler`, pick an expiration, click **Add**.
   ![Step 2: Create admin key](../assets/providers/anthropic-2.png)
3. Copy the key (it starts with `sk-ant-admin01-`). It is shown only once.

## 3. Paste into Tickler

| Field | Value |
| --- | --- |
| Admin API key | `sk-ant-admin01-...` |

Click **Test**: it reads your organization's name (`GET /v1/organizations/me`).

## What Tickler shows

- **Cost:** daily totals and a line per model (from the cost report, grouped by description).
  Web search and code execution appear as their own lines.
- **Tokens:** daily input (uncached, cache writes and cache reads) plus output tokens per model.
- **Forecast:** month to date plus the last 7 days' average times the days left.

## Troubleshooting

- **Test says the key is not configured:** the key must start with `sk-ant-admin`. A normal API
  key (`sk-ant-api...`) cannot read usage.
- **HTTP 401:** the key was revoked or expired. Create a new one.
- **Admin keys page not found:** your account is an individual account. Set up an organization
  first (step 1).
- **HTTP 403:** your account is not an organization, or you are not an admin.

## Sources

Checked: 2026-11-06

- https://platform.claude.com/docs/en/manage-claude/admin-api (individual accounts, admin role)
- https://platform.claude.com/docs/en/manage-claude/admin-api-keys (key creation, `sk-ant-admin01-`)
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve
- https://platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages
- https://platform.claude.com/docs/en/manage-claude/admin-api-keys
- https://platform.claude.com/docs/en/api/versioning

Note: Anthropic now labels these two endpoints "Legacy" (still supported) and recommends the newer
Usage and Cost Analytics API for new integrations. Tickler uses the supported legacy endpoints
with `anthropic-version: 2023-06-01`; verify when Anthropic announces a retirement date.

## Screenshots needed

- `anthropic-1.png`: Console Settings with Admin keys selected
- `anthropic-2.png`: Create admin key dialog with name and expiration
