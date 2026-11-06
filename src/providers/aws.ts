// AWS: Cost Explorer GetCostAndUsage (daily cost by service) and GetCostForecast.
// Every Cost Explorer request costs USD 0.01, so this syncs at most every 6 hours.
// Docs: https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html

import { signedJsonPost, type AwsCredentials } from "./sigv4";
import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { addDays, bump, monthEnd, monthOf, monthStart, num, parseYmd, ProviderError, request, required, snap, syncWindow, testWith, ymd } from "./util";

const HOST = "ce.us-east-1.amazonaws.com";
const LATENCY = "~1 day";

function creds(cfg: ProviderConfig): AwsCredentials {
  return { accessKeyId: cfg.access_key_id.trim(), secretAccessKey: cfg.secret_access_key.trim() };
}

async function ce(ctx: SyncContext, cfg: ProviderConfig, action: string, body: unknown): Promise<any> {
  const { url, init } = await signedJsonPost({
    creds: creds(cfg),
    region: "us-east-1",
    service: "ce",
    host: HOST,
    target: `AWSInsightsIndexService.${action}`,
    body: JSON.stringify(body),
    now: ctx.now,
  });
  const res = await request(ctx.fetch, `AWS ${action}`, url, init);
  return res.json();
}

export const aws: Provider = {
  id: "aws",
  displayName: "AWS",
  kind: "cost",
  guide: "providers/aws",
  freshness: "every 6 hours, about 1 day behind",
  syncEveryMinutes: 360,
  fields: [
    { key: "access_key_id", label: "Access key ID", secret: false, help: "From an IAM user that can only call ce:GetCostAndUsage and ce:GetCostForecast." },
    { key: "secret_access_key", label: "Secret access key", secret: true },
  ],

  configured: (cfg) => required(cfg, "access_key_id", "secret_access_key"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const day = ymd(addDays(ctx.now, -1));
      await ce(ctx, cfg, "GetCostAndUsage", {
        TimePeriod: { Start: day, End: ymd(ctx.now) },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
      });
      return "Connected to Cost Explorer (this test cost USD 0.01).";
    }),

  async sync(cfg, ctx) {
    const { start, end } = syncWindow(ctx.now);
    const endExclusive = ymd(addDays(parseYmd(end), 1));
    const totals = new Map<string, number>();
    const byService = new Map<string, number>();
    let unit = "USD";
    let token: string | undefined;
    let pages = 0;
    do {
      const r = await ce(ctx, cfg, "GetCostAndUsage", {
        TimePeriod: { Start: start, End: endExclusive },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
        ...(token ? { NextPageToken: token } : {}),
      });
      for (const day of r.ResultsByTime ?? []) {
        const date = day.TimePeriod.Start;
        totals.set(date, totals.get(date) ?? 0);
        for (const g of day.Groups ?? []) {
          const m = g.Metrics?.UnblendedCost;
          if (!m) continue;
          unit = m.Unit || unit;
          bump(totals, date, num(m.Amount));
          bump(byService, `${date}|${g.Keys[0]}`, num(m.Amount));
        }
      }
      token = r.NextPageToken || undefined;
    } while (token && ++pages < 10);

    const snapshots: MetricSnapshotInput[] = [];
    for (const [date, value] of totals) snapshots.push(snap("aws", "default", "cost", unit, value, date, date, { source_latency: LATENCY }));
    for (const [key, value] of byService) {
      const [date, service] = key.split("|");
      if (value !== 0) snapshots.push(snap("aws", "default", "cost", unit, value, date, date, { label: service, source_latency: LATENCY }));
    }

    // Provider forecast for the rest of this month, plus what is already spent.
    const month = monthOf(ctx.now);
    const today = ymd(ctx.now);
    const nextMonth = ymd(addDays(parseYmd(monthEnd(month)), 1));
    try {
      const f = await ce(ctx, cfg, "GetCostForecast", {
        TimePeriod: { Start: today, End: nextMonth },
        Granularity: "MONTHLY",
        Metric: "UNBLENDED_COST",
      });
      let spent = 0;
      for (const [date, v] of totals) if (date >= monthStart(month) && date < today) spent += v;
      const rest = num(f.Total?.Amount);
      snapshots.push(
        snap("aws", "default", "forecast", f.Total?.Unit || unit, spent + rest, monthStart(month), monthEnd(month), {
          source_latency: LATENCY,
          raw: { spent_before_today: spent, forecast_rest: rest },
        }),
      );
    } catch (e) {
      // Not enough history for a forecast yet: Tickler falls back to the 7 day run rate.
      if (!(e instanceof ProviderError && /DataUnavailable|insufficient/i.test(e.message))) throw e;
    }
    return { snapshots };
  },
};
