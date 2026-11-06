# GitHub

Shows GitHub spend per day and per product (Actions, Copilot, Packages, storage, seats) and the
usage quantities (minutes, requests, GB) for your personal account or one organization, from
the billing usage API (enhanced billing platform).

- **Pulled every hour.** GitHub posts usage about daily, so the newest day is often missing.
- Amounts are the **net** amount after included quotas and discounts, in USD.

## 1. Create a fine-grained token

1. **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new
   token**.
   ![Step 1: fine-grained tokens](../assets/providers/github-1.png)
2. Name `Tickler billing`, pick an expiration.
3. **Resource owner:** your user (personal billing) or the organization (organization billing).
4. **Repository access:** Public repositories (no repository access is needed).
5. **Permissions:**
   - Personal account: **Account permissions > Plan: Read-only**.
   - Organization: **Organization permissions > Administration: Read-only**. You must be an
     organization owner or billing manager, and the organization may need to approve the token.
   ![Step 5: permission set to Read-only](../assets/providers/github-5.png)
6. **Generate token** and copy it.

Note: Administration (read) also lets the token read other organization settings. It is the only
permission GitHub accepts for organization billing; it cannot change anything.

## 2. Paste into Tickler

| Field | Value |
| --- | --- |
| Fine-grained token | `github_pat_...` |
| Username or organization | e.g. `octocat` or `acme` |
| Account type (optional) | `user` (default) or `org` |

Click **Test**: it reads this month's usage lines.

## Troubleshooting

- **HTTP 404:** wrong owner name, or the account is not on the enhanced billing platform.
- **HTTP 403:** the token lacks Plan (user) or Administration (organization) read, or the
  organization has not approved it.
- The old `/settings/billing/actions` endpoints closed on 2025-09-26; Tickler does not use them.

## Sources

Checked: 2026-11-06

- https://docs.github.com/en/rest/billing/usage
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://docs.github.com/en/rest/about-the-rest-api/api-versions
- https://github.blog/changelog/2025-09-26-product-specific-billing-apis-are-closing-down

## Screenshots needed

- `github-1.png`: Developer settings > Fine-grained tokens
- `github-5.png`: permissions with Plan (or Administration) on Read-only
