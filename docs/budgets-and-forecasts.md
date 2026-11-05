# Budgets and forecasts

Budgets and forecasts live in the **Money** tab (Tickler Pro). They work for any cost source you've connected, and for the fixed costs you enter by hand.

## Budgets

A budget is a monthly limit, either for one service (say, AWS) or for **all costs** together.

To add one: **Money**, then a service's card (or **This month** for all costs), then **Budget**.

- **Monthly limit:** an amount in your server's currency.
- **Steps:** when to warn you. The default is 50%, 80% and 100%. You can change them.

### What happens when spending crosses a step

The first time spending crosses a step in a month, Tickler:

1. Creates an **alert**.
2. Adds an entry in the **Money** project, marked **important** (or **critical** at 100% and above), so it shows in the Important tab.
3. Sends a notification, at the next sync (see [Notifications](/guides/notifications)).

Each step alerts **once per month**. If spending jumps past several steps between two checks (say from 40% to 120%), you get one critical entry, not three.

Budgets are checked every time a source syncs and again every day at 06:00 UTC.

### Fixed costs count too

Fixed costs you entered by hand (developer programs, domains, hosting) count toward the **all costs** budget in the month they renew. Tickler also adds an Important entry 14 days before each renewal, so a yearly fee never surprises you.

## Forecasts

The forecast is Tickler's best guess at the month-end total.

1. **The provider's own forecast** when there is one (AWS Cost Explorer, Google Cloud budgets). Providers know about things Tickler can't see, like reserved instances.
2. **Otherwise, the 7 day run rate:** what has been spent in the complete days so far this month, plus the average of the last 7 complete days, times the days left.

Details that make it fair:

- **Complete days only.** Today's partial number is left out; the 7 day average stands in for it.
- **Lagging sources.** For sources that report a day late (like store reports), "complete" means up to the last day the source has data for.
- **New sources.** With fewer than 7 days of data, the average uses the days there are.
- **Past months** show the actual total, not a forecast.

The detail screen shows the method used: **Provider**, **7 day run rate**, or **Mixed** for totals that combine both.

## "As of" times

Every number shows when it was fetched, and each source's usual delay. A cost that's "as of 6 hours ago, ~1 day behind" is honest about being an estimate. See the freshness table in [Money](/guides/money#how-fresh-are-the-numbers).

## Currency

v1 reports everything in one base currency, set on your server with `TICKLER_CURRENCY` (default `USD`). If a provider bills in another currency and doesn't give a converted amount, its numbers are shown separately and left out of totals and budgets, with a note.
