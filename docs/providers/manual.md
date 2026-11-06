# Manual numbers and fixed costs

For anything Tickler has no adapter for: a hosting bill, ad spend, sponsorships, a number from a
script. No remote calls and nothing to configure; it is always connected.

## Fixed costs

Add recurring costs (developer program fees, domains, hosting) in the app under **Money > Fixed
costs** with amount, currency, interval (monthly or yearly) and the next renewal date.

- They count in the month they are charged: monthly ones every month, yearly ones in their
  renewal month. Month to date includes a charge once its day has come; the forecast includes
  every charge in the month.
- 14 days before each renewal Tickler adds an Important entry in the "Money" project
  ("Renewal: ..."), on the renewal day. Re-running never duplicates it.
- Fixed costs in another currency are shown with a note and left out of totals.

## Push a number: `POST /api/metrics`

Use a device token or an MCP token (`tkm_...`, create one under Settings > AI tools or on `/setup`).

```sh
curl -X POST https://<your-server>/api/metrics \
  -H "Authorization: Bearer tkm_..." \
  -H "Content-Type: application/json" \
  -d '{"provider":"manual","metric":"cost","unit":"USD","value":12.5,"period_start":"2026-11-05","label":"Hetzner"}'
```

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | always `manual` |
| `metric` | yes | `cost`, `revenue`, `proceeds`, `units`, `usage` or `forecast` |
| `unit` | yes | currency code (`USD`) or a unit (`requests`, `users`) |
| `value` | yes | a number in major units (`12.50`) |
| `period_start` | yes | `YYYY-MM-DD` |
| `period_end` | no | defaults to `period_start` (a daily value) |
| `account` | no | defaults to `default` |
| `label` | no | a breakdown line; leave empty for a day's total |

Sending the same provider, account, metric, label and period again replaces the value, so a
script can re-send safely. For totals, send one value per day with no label; labeled values only
appear as breakdown lines.

Freshness: whenever you send it.

## Sources

Checked: 2026-11-06 (Tickler's own API: `docs/reference/api-contract.md`)
