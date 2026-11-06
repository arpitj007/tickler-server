# OpenAI

Shows your OpenAI API spend per day and per line item (model and token type), and tokens per
model, from the organization Costs and Usage APIs.

- **Pulled every hour.** Costs are daily buckets; the current day fills in during the day.

## 1. Create an admin key

Organization owners can create admin keys.

1. Open [platform.openai.com](https://platform.openai.com) > **Settings > Organization > Admin
   keys** (`/settings/organization/admin-keys`).
   ![Step 1: Admin keys](../assets/providers/openai-1.png)
2. **Create new admin key**, name `Tickler`. If the dialog offers permissions, choose
   **Restricted** or **Read only** and give read access to usage (verify: OpenAI's API reference
   documents no scopes for admin keys; some dashboards show a permission choice).
   ![Step 2: create admin key](../assets/providers/openai-2.png)
3. Copy the key (starts with `sk-admin-`). It is shown once.

Admin keys only work on administration endpoints, not for model calls. If yours has full admin
rights, treat it like a password: Tickler keeps it encrypted on your server and only reads costs
and usage.

## 2. Paste into Tickler

| Field | Value |
| --- | --- |
| Admin key | `sk-admin-...` |

Click **Test**: it reads one day of costs.

## Troubleshooting

- **HTTP 401 / 403:** a project or user key was pasted instead of an admin key, or the key was
  revoked.
- **Costs look low today:** today's bucket is partial; the forecast uses complete days only.

## Sources

Checked: 2026-11-06 (platform.openai.com returned 403 to automated checks; the same reference
was read on developers.openai.com)

- https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
- https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions
- https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/admin_api_keys/methods/create
- https://developers.openai.com/api/docs/guides/admin-apis.md

## Screenshots needed

- `openai-1.png`: Settings > Organization > Admin keys
- `openai-2.png`: create admin key dialog
