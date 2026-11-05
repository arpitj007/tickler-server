// Deterministic demo data generator. Produces a full /api/changes response (cursor "0" base)
// with every time written as a "__NOW__±duration" / "__TODAY__±duration" placeholder.
// See docs/reference/api-contract.md, "Demo data".

type Json = Record<string, unknown>;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO 8601 duration offset from minutes, e.g. 3*1440+90 -> "+P3DT1H30M". */
export function offset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  let m = Math.abs(Math.round(minutes));
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  let s = "P";
  if (d) s += `${d}D`;
  if (h || m) s += "T" + (h ? `${h}H` : "") + (m ? `${m}M` : "");
  if (s === "P") s = "PT0M";
  return sign + s;
}
const now = (minutes: number) => `__NOW__${offset(minutes)}`;
const today = (minutes: number) => `__TODAY__${offset(minutes)}`;
const DAY = 1440;

export function generateDemo(): Json {
  const rnd = mulberry32(20261106);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const uuid = () => {
    const h = Array.from({ length: 32 }, () => Math.floor(rnd() * 16).toString(16));
    h[12] = "4";
    h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
    const s = h.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  let rev = 0;
  const nextRev = () => ++rev;

  // Projects
  const projectDefs = [
    { name: "Tickler launch", slug: "tickler-launch", color: "#5B5BD6", icon: "paperplane" },
    { name: "Culina AI", slug: "culina-ai", color: "#E5484D", icon: "fork.knife" },
    { name: "Home server", slug: "home-server", color: "#30A46C", icon: "server.rack" },
    { name: "Money", slug: "money", color: "#F5A524", icon: "dollarsign.circle" },
    { name: "Client: Acme", slug: "client-acme", color: "#0090FF", icon: "briefcase" },
    { name: "Personal", slug: "personal", color: "#8E4EC6", icon: "person" },
  ];
  const projects = projectDefs.map((p, i) => ({
    id: uuid(),
    ...p,
    archived: false,
    created_at: now(-(60 - i) * DAY),
    updated_at: now(-(30 - i) * DAY),
    rev: nextRev(),
  }));
  const proj = (slug: string) => projects.find((p) => p.slug === slug)!;

  // Origins
  type O = Json & { id: string; client: string };
  const origins: O[] = [];
  const mkOrigin = (o: Partial<O> & { client: string; title: string }, ageMin: number, parent?: O): O => {
    const id = uuid();
    const sid = "session_id" in o ? ((o.session_id as string | null) ?? null) : uuid();
    const row: O = {
      id,
      client: o.client,
      session_id: sid,
      title: o.title,
      open_url: o.open_url ?? null,
      resume_command: o.resume_command ?? null,
      machine: o.machine ?? null,
      cwd: o.cwd ?? null,
      repo: o.repo ?? null,
      branch: o.branch ?? null,
      transcript_path: o.transcript_path ?? null,
      parent_origin_id: parent?.id ?? null,
      first_seen_at: now(-ageMin),
      last_seen_at: now(-Math.max(5, ageMin - int(10, 600))),
      rev: nextRev(),
    };
    origins.push(row);
    return row;
  };
  const cc = (title: string, repo: string, branch: string, ageMin: number, parent?: O) => {
    const sid = uuid();
    const cwd = `/Users/aj/dev/${repo}`;
    return mkOrigin(
      {
        client: "claude_code",
        session_id: sid,
        title,
        resume_command: `cd ${cwd} && claude --resume ${sid}`,
        machine: pick(["aj-mbp.local", "aj-studio.local"]),
        cwd,
        repo: `github.com/arpitj007/${repo}`,
        branch,
        transcript_path: `/Users/aj/.claude/projects/-Users-aj-dev-${repo}/${sid}.jsonl`,
      },
      ageMin,
      parent,
    );
  };
  const ccMain = cc("Ship the MCP server and OAuth flow", "tickler-server", "main", 9 * DAY);
  const ccSub = cc("Subagent: write OAuth tests", "tickler-server", "main", 9 * DAY - 30, ccMain);
  const ccApp = cc("Build Timeline Week view", "tickler-app", "feature/week-view", 5 * DAY);
  const ccCulina = cc("Fix recipe import for metric units", "culina-ai", "fix/units", 12 * DAY);
  const ccHome = cc("Set up restic backups to B2", "homelab", "main", 20 * DAY);
  const ccWebSid = uuid();
  const ccWeb = mkOrigin(
    {
      client: "claude_code_web",
      session_id: ccWebSid,
      title: "Review Acme checkout PR and plan follow-ups",
      open_url: `https://claude.ai/code/${ccWebSid}`,
      repo: "github.com/acme-corp/storefront",
      branch: "checkout-v2",
    },
    3 * DAY,
  );
  const claudeAppSid = uuid();
  const claudeApp = mkOrigin(
    { client: "claude_app", session_id: claudeAppSid, title: "Launch plan for Tickler on Product Hunt", open_url: `https://claude.ai/chat/${claudeAppSid}` },
    7 * DAY,
  );
  const claudeApp2 = mkOrigin({ client: "claude_app", session_id: null, title: "Tax prep checklist 2026" }, 15 * DAY);
  const cursor = mkOrigin(
    { client: "cursor", title: "Refactor Culina meal planner", machine: "aj-mbp.local", cwd: "/Users/aj/dev/culina-ai", repo: "github.com/arpitj007/culina-ai", branch: "planner-refactor" },
    10 * DAY,
  );
  const chatgptSid = uuid();
  const chatgpt = mkOrigin(
    { client: "chatgpt", session_id: chatgptSid, title: "Compare NAS options for the home server", open_url: `https://chatgpt.com/c/${chatgptSid}` },
    25 * DAY,
  );
  const codex = mkOrigin(
    { client: "codex", title: "Migrate Acme API to Node 22", machine: "aj-studio.local", cwd: "/Users/aj/dev/acme-api", repo: "github.com/acme-corp/api", branch: "node22" },
    6 * DAY,
  );
  const gemini = mkOrigin(
    { client: "gemini_cli", title: "Draft Culina App Store screenshots copy", machine: "aj-mbp.local", cwd: "/Users/aj/dev/culina-ai" },
    4 * DAY,
  );
  const t3Sid = uuid();
  const t3 = mkOrigin({ client: "t3_code", session_id: t3Sid, title: "Nightly dependency sweep", open_url: `t3-thread://v1/${t3Sid}` }, 8 * DAY);
  const sched = mkOrigin({ client: "scheduled_task", title: "Weekly backup verification run", machine: "homeserver" }, 30 * DAY, ccHome);
  const sched2 = mkOrigin({ client: "scheduled_task", title: "Daily App Store review digest" }, 2 * DAY, t3);
  const other = mkOrigin({ client: "other", session_id: null, title: "Unknown MCP client" }, 1 * DAY);

  // Entries
  const kinds = ["task", "event", "deadline", "reminder", "scheduled_run", "follow_up", "launch", "renewal"] as const;
  const entries: Json[] = [];
  const mkEntry = (
    slug: string,
    title: string,
    kind: (typeof kinds)[number],
    startMin: number | null,
    o: O | null,
    extra: Json = {},
  ) => {
    const id = uuid();
    const created = Math.min(startMin ?? 0, 0) - int(60, 6 * DAY);
    const isPast = startMin !== null && startMin < 0;
    let status = (extra.status as string) ?? (isPast ? pick(["done", "done", "done", "planned", "skipped"]) : "planned");
    if (kind === "event" && isPast && !extra.status) status = "done";
    const allDay = (extra.all_day as boolean) ?? false;
    const start = startMin === null ? null : allDay ? today(Math.round(startMin / DAY) * DAY) : now(startMin);
    const dur = (extra.duration as number) ?? (kind === "event" ? 60 : kind === "scheduled_run" ? 15 : 0);
    delete extra.duration;
    entries.push({
      id,
      project_id: proj(slug).id,
      title,
      notes: null,
      kind,
      start_at: start,
      end_at: startMin !== null && dur && !allDay ? now(startMin + dur) : null,
      all_day: allDay,
      timezone: pick(["Europe/Berlin", "Europe/Berlin", "America/New_York", "UTC"]),
      recurrence: null,
      status,
      importance: "normal",
      source: o ? "agent" : "manual",
      origin_id: o?.id ?? null,
      last_origin_id: o?.id ?? null,
      origin_flagged: o?.client === "other",
      external_key: null,
      links: [],
      tags: [],
      source_ref: null,
      completed_at: status === "done" && startMin !== null ? now(Math.min(startMin + int(5, 300), -5)) : null,
      created_at: now(created),
      updated_at: now(Math.min(created + int(1, 600), -1)),
      deleted_at: null,
      rev: nextRev(),
      ...extra,
    });
    return id;
  };
  const H = 60;
  const at = (days: number, hour: number) => days * DAY + (hour - 12) * H; // relative to "now", roughly at hour

  // Tickler launch
  mkEntry("tickler-launch", "Submit Tickler 1.0 for App Review", "deadline", at(12, 17), claudeApp, { importance: "critical", external_key: "launch-submit-1.0", links: [{ title: "Launch plan", url: "https://github.com/arpitj007/tickler-server/discussions/1" }] });
  mkEntry("tickler-launch", "Product Hunt launch", "launch", at(26, 9), claudeApp, { importance: "critical", all_day: true, external_key: "launch-ph" });
  mkEntry("tickler-launch", "Show HN post (write it yourself)", "launch", at(27, 15), claudeApp, { importance: "important", notes: "HN discourages AI written posts. Draft by hand." });
  mkEntry("tickler-launch", "Check TestFlight crash reports", "follow_up", at(2, 10), ccApp, { importance: "important", source_ref: "https://github.com/arpitj007/tickler-app/pull/42" });
  mkEntry("tickler-launch", "Merge OAuth PR after review", "follow_up", at(1, 11), ccMain, { source_ref: "https://github.com/arpitj007/tickler-server/pull/7", external_key: "pr-7-merge" });
  mkEntry("tickler-launch", "Re-run OAuth tests on Workers pool", "task", at(-3, 14), ccSub, { status: "done", source_ref: "a1b2c3d" });
  mkEntry("tickler-launch", "Record App Preview video", "task", null, claudeApp);
  mkEntry("tickler-launch", "Write privacy policy page", "task", null, null);
  mkEntry("tickler-launch", "Take 6.9 inch screenshots", "task", at(5, 16), ccApp, { importance: "important" });
  mkEntry("tickler-launch", "Reserve name in App Store Connect", "task", at(-20, 10), null, { status: "done" });
  mkEntry("tickler-launch", "Public beta feedback review", "event", at(9, 18), claudeApp, { duration: 45, recurrence: "FREQ=WEEKLY;BYDAY=FR" });
  mkEntry("tickler-launch", "Post in r/selfhosted (check rules first)", "reminder", at(28, 17), claudeApp);
  mkEntry("tickler-launch", "Submit to MCP Registry", "task", at(29, 10), ccMain);
  mkEntry("tickler-launch", "Nightly demo server reset", "scheduled_run", at(0, 23) + 30, sched2, { recurrence: "FREQ=DAILY", external_key: "demo-reset" });
  mkEntry("tickler-launch", "Docs site: Cloudflare guide screenshots", "task", at(4, 13), ccMain);
  mkEntry("tickler-launch", "Week view perf with 2,000 entries", "follow_up", at(3, 15), ccApp, { source_ref: "https://github.com/arpitj007/tickler-app/issues/18" });
  mkEntry("tickler-launch", "TestFlight public beta opens", "launch", at(-6, 9), claudeApp, { importance: "important", status: "done" });
  mkEntry("tickler-launch", "Check App Review status", "follow_up", at(15, 10), claudeApp, { importance: "important" });
  mkEntry("tickler-launch", "Ask beta testers about pairing flow", "follow_up", at(-2, 11), ccApp, { status: "planned" });
  mkEntry("tickler-launch", "Trademark search results", "follow_up", at(-12, 10), claudeApp2, { status: "done" });

  // Culina AI
  mkEntry("culina-ai", "Culina 2.3 release", "launch", at(8, 10), gemini, { importance: "important", external_key: "culina-2.3" });
  mkEntry("culina-ai", "Verify metric unit import on staging", "follow_up", at(-1, 15), ccCulina, { status: "planned", importance: "important", source_ref: "https://github.com/arpitj007/culina-ai/pull/311" });
  mkEntry("culina-ai", "Remove meal planner feature flag", "task", at(14, 12), cursor, { source_ref: "https://github.com/arpitj007/culina-ai/pull/318" });
  mkEntry("culina-ai", "Reply to App Store reviews", "reminder", at(1, 9), sched2, { recurrence: "FREQ=WEEKLY;BYDAY=MO", external_key: "reviews-weekly" });
  mkEntry("culina-ai", "Screenshot copy approval", "deadline", at(3, 17), gemini);
  mkEntry("culina-ai", "Rotate OpenAI API key", "task", at(20, 10), cursor, { importance: "important" });
  mkEntry("culina-ai", "Recipe parser regression check", "scheduled_run", at(-4, 3), t3, { status: "done" });
  mkEntry("culina-ai", "Check crash-free rate after 2.2.1", "follow_up", at(-9, 10), ccCulina, { status: "done" });
  mkEntry("culina-ai", "Localize onboarding into German", "task", null, cursor);
  mkEntry("culina-ai", "Plan pantry sync feature", "task", null, null);
  mkEntry("culina-ai", "Google Play policy declaration due", "deadline", at(18, 23), gemini, { importance: "critical" });
  mkEntry("culina-ai", "Subscription price test ends", "event", at(11, 9), cursor, { all_day: true });

  // Home server
  mkEntry("home-server", "Verify restic backup restore", "scheduled_run", at(2, 4), sched, { recurrence: "FREQ=WEEKLY;BYDAY=SU", external_key: "backup-verify" });
  mkEntry("home-server", "Replace failing disk in bay 2", "deadline", at(4, 18), chatgpt, { importance: "critical", notes: "SMART shows reallocated sectors rising." });
  mkEntry("home-server", "Renew Let's Encrypt wildcard (manual DNS)", "renewal", at(22, 10), ccHome, { importance: "important" });
  mkEntry("home-server", "Update Proxmox to 9.1", "task", at(6, 20), ccHome);
  mkEntry("home-server", "Check UPS battery self test", "reminder", at(-5, 19), null, { status: "skipped" });
  mkEntry("home-server", "Decide on NAS (see comparison)", "follow_up", at(-15, 10), chatgpt, { status: "done" });
  mkEntry("home-server", "Move Tickler container to new host", "task", null, ccHome);
  mkEntry("home-server", "Tailscale ACL review", "task", at(30, 10), null);

  // Money (system and agent)
  mkEntry("money", "Apple Developer Program renews", "renewal", at(10, 9), null, { importance: "important", source: "system", all_day: true, external_key: "fixed-cost-apple-dev" });
  mkEntry("money", "Domain gettickler.com renews", "renewal", at(40, 9), null, { source: "system", all_day: true });
  mkEntry("money", "AWS bill check", "reminder", at(-10, 10), codex, { status: "done" });
  mkEntry("money", "File quarterly VAT return", "deadline", at(16, 17), claudeApp2, { importance: "critical" });
  mkEntry("money", "Cancel unused Vercel Pro seat", "task", at(2, 12), codex);
  mkEntry("money", "Review OpenAI spend after Culina 2.3", "follow_up", at(10, 15), cursor);

  // Client: Acme
  mkEntry("client-acme", "Acme checkout v2 go-live", "launch", at(7, 8), ccWeb, { importance: "critical", external_key: "acme-checkout-v2" });
  mkEntry("client-acme", "Follow up on PR #1284 review comments", "follow_up", at(1, 14), ccWeb, { source_ref: "https://github.com/acme-corp/storefront/pull/1284" });
  mkEntry("client-acme", "Invoice Acme for October", "deadline", at(-4, 17), null, { status: "done", importance: "important" });
  mkEntry("client-acme", "Weekly Acme sync", "event", at(2, 15), null, { recurrence: "FREQ=WEEKLY;BYDAY=TU", duration: 30 });
  mkEntry("client-acme", "Node 22 migration staging deploy", "scheduled_run", at(3, 6), codex, { external_key: "acme-node22-staging" });
  mkEntry("client-acme", "Check error rate after Node 22 rollout", "follow_up", at(5, 10), codex);
  mkEntry("client-acme", "Load test checkout", "task", at(-2, 13), ccWeb, { status: "planned", importance: "important" });
  mkEntry("client-acme", "SOW renewal", "renewal", at(35, 10), null, { importance: "important" });
  mkEntry("client-acme", "Question from unknown client", "task", at(1, 16), other);

  // Personal
  mkEntry("personal", "Dentist", "event", at(6, 9), null, { duration: 45 });
  mkEntry("personal", "Passport renewal appointment", "event", at(19, 11), null, { importance: "important" });
  mkEntry("personal", "Mom's birthday", "event", at(23, 0), null, { all_day: true, recurrence: "FREQ=YEARLY" });
  mkEntry("personal", "Tax documents to accountant", "deadline", at(13, 17), claudeApp2, { importance: "important" });
  mkEntry("personal", "Gym", "event", at(1, 7), null, { recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR", duration: 60 });
  mkEntry("personal", "Call the insurance about the bike", "task", null, null);

  // Fill to ~120 with generic but realistic agent entries spread over +-45 days
  const filler: Array<[string, string, (typeof kinds)[number], O | null]> = [
    ["tickler-launch", "Check GitHub issues from beta testers", "follow_up", ccMain],
    ["tickler-launch", "Update README quick start", "task", ccMain],
    ["tickler-launch", "Review Dependabot PRs", "task", t3],
    ["tickler-launch", "Docker image size check", "scheduled_run", t3],
    ["culina-ai", "Look at Crashlytics-free crash reports", "follow_up", ccCulina],
    ["culina-ai", "Recipe embeddings reindex", "scheduled_run", t3],
    ["culina-ai", "Respond to support emails", "reminder", null],
    ["culina-ai", "Check subscription conversion", "follow_up", cursor],
    ["home-server", "Prune old Docker images", "scheduled_run", sched],
    ["home-server", "Check disk temperatures", "reminder", sched],
    ["client-acme", "Acme standup notes", "task", codex],
    ["client-acme", "Review Acme Sentry alerts", "follow_up", ccWeb],
    ["money", "Look at Cloudflare usage spike", "follow_up", ccMain],
    ["personal", "Water the plants", "reminder", null],
    ["personal", "Book flights for December", "task", claudeApp2],
  ];
  let i = 0;
  while (entries.length < 120) {
    const [slug, title, kind, o] = filler[i % filler.length]!;
    const day = int(-45, 45);
    mkEntry(slug, title, kind, at(day, int(8, 19)), o, rnd() < 0.15 ? { importance: "important" } : {});
    i++;
  }
  // A cancelled and a deleted one for completeness
  mkEntry("client-acme", "Acme offsite (cancelled)", "event", at(9, 10), null, { status: "cancelled" });
  mkEntry("personal", "Old reminder (deleted)", "reminder", at(-8, 10), null, { deleted_at: now(-7 * DAY) });

  // Money: budgets, metric snapshots, sales events, fixed costs, alerts
  const budgets = [
    { id: uuid(), provider: "anthropic", project_id: null, monthly_limit: 300, currency: "USD", thresholds: [0.5, 0.8, 1.0], created_at: now(-50 * DAY), updated_at: now(-50 * DAY), rev: nextRev() },
    { id: uuid(), provider: "aws", project_id: null, monthly_limit: 100, currency: "USD", thresholds: [0.5, 0.8, 1.0], created_at: now(-50 * DAY), updated_at: now(-50 * DAY), rev: nextRev() },
    { id: uuid(), provider: null, project_id: null, monthly_limit: 600, currency: "USD", thresholds: [0.5, 0.8, 1.0], created_at: now(-50 * DAY), updated_at: now(-40 * DAY), rev: nextRev() },
  ];
  const alertEntry = mkEntry("money", "Anthropic spend passed 50% of the monthly budget", "reminder", -2 * DAY, null, {
    source: "system",
    importance: "important",
    status: "planned",
    external_key: "budget-anthropic-0.5",
    notes: "USD 151.20 of USD 300.00 used.",
  });
  const alerts = [
    { id: uuid(), budget_id: budgets[0]!.id, month: "__NOW__", threshold: 0.5, entry_id: alertEntry, value: 151.2, created_at: now(-2 * DAY), rev: nextRev() },
  ];

  const metric_snapshots: Json[] = [];
  const snap = (provider: string, metric: string, unit: string, value: number, dayAgo: number, label: string | null, latency: string) => {
    metric_snapshots.push({
      id: uuid(),
      provider,
      account: provider === "aws" ? "123456789012" : "default",
      metric,
      unit,
      value: round2(value),
      label,
      period_start: today(-dayAgo * DAY),
      period_end: today(-dayAgo * DAY),
      fetched_at: now(-dayAgo * DAY + int(60, 600)),
      source_latency: latency,
      rev: nextRev(),
    });
  };
  // Convention (src/money/summary.ts): a day's money total has label null; labeled rows are
  // breakdown lines for top_lines and are never added to totals.
  const costDay = (provider: string, d: number, lines: Array<[string, number]>, latency: string) => {
    snap(provider, "cost", "USD", lines.reduce((a, [, v]) => a + round2(v), 0), d, null, latency);
    for (const [label, v] of lines) snap(provider, "cost", "USD", v, d, label, latency);
  };
  for (let d = 60; d >= 0; d--) {
    const growth = 1 + (60 - d) / 120;
    const weekend = d % 7 < 2 ? 1.25 : 1;
    if (d >= 1) {
      snap("app_store", "proceeds", "USD", (18 + rnd() * 22) * growth * weekend, d, null, "~1 day");
      snap("app_store", "units", "units", Math.round(int(4, 14) * growth), d, null, "~1 day");
      snap("google_play", "proceeds", "USD", (6 + rnd() * 12) * growth, d, null, "~1 day");
      snap("google_play", "units", "units", int(2, 8), d, null, "~1 day");
      costDay("aws", d, [["Amazon EC2", 1.6 + rnd()], ["Amazon S3", 0.3 + rnd() * 0.3], ["Amazon RDS", 0.5 + rnd() * 0.3]], "~1 day");
      costDay("github", d, [["Actions", 0.15 + rnd() * 0.5]], "~1 day");
      snap("github", "usage", "minutes", int(40, 260), d, "Actions minutes", "~1 day");
    }
    snap("stripe", "revenue", "USD", (25 + rnd() * 40) * growth, d, null, "seconds");
    costDay("anthropic", d, [["claude-sonnet-4-5", 3 + rnd() * 5], ["claude-haiku-4-5", 1 + rnd() * 2.5]], "~1 hour");
    snap("anthropic", "usage", "tokens", int(800_000, 3_000_000), d, "claude-sonnet-4-5", "~1 hour");
    snap("cloudflare", "usage", "requests", int(40_000, 180_000), d, "Workers requests", "~1 hour");
    costDay("cloudflare", d, [["Workers", 0.05 + rnd() * 0.2]], "~1 hour");
    costDay("openai", d, [["gpt-5-mini", 0.8 + rnd() * 2.2]], "~1 hour");
  }
  // AWS provider forecast for the current month
  metric_snapshots.push({
    id: uuid(), provider: "aws", account: "123456789012", metric: "forecast", unit: "USD", value: 96.4, label: null,
    period_start: "__MONTH_START__", period_end: "__MONTH_END__", fetched_at: now(-180), source_latency: "~1 day", rev: nextRev(),
  });

  const sales_events: Json[] = [];
  const products = { app_store: ["tickler.pro.monthly", "tickler.pro.yearly", "tickler.pro.lifetime"], google_play: ["culina_premium_monthly", "culina_premium_yearly"], stripe: ["acme_retainer", "culina_web_yearly"] } as const;
  const prices: Record<string, number> = { "tickler.pro.monthly": 2.99, "tickler.pro.yearly": 19.99, "tickler.pro.lifetime": 49.99, culina_premium_monthly: 4.99, culina_premium_yearly: 39.99, acme_retainer: 1500, culina_web_yearly: 39.99 };
  for (let k = 0; k < 60; k++) {
    const store = pick(["app_store", "app_store", "app_store", "google_play", "google_play", "stripe"] as const);
    const product = pick(products[store]);
    const type = pick(["purchase", "subscribed", "subscribed", "renewed", "renewed", "renewed", "trial_started", "trial_started", "refunded", "cancelled", "billing_issue"] as const);
    sales_events.push({
      id: uuid(),
      store,
      type,
      product_id: product,
      price: type === "trial_started" || type === "cancelled" || type === "billing_issue" ? null : type === "refunded" ? -prices[product]! : prices[product]!,
      currency: "USD",
      country: pick(["US", "DE", "GB", "IN", "FR", "CA", "JP", "NL"]),
      occurred_at: now(-int(10, 30 * DAY)),
      rev: nextRev(),
    });
  }
  sales_events.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));

  const fixed_costs = [
    { id: uuid(), name: "Apple Developer Program", amount: 99, currency: "USD", interval: "yearly", renews_on: today(10 * DAY), project_id: proj("tickler-launch").id },
    { id: uuid(), name: "Google Play developer account", amount: 25, currency: "USD", interval: "yearly", renews_on: today(200 * DAY), project_id: proj("culina-ai").id },
    { id: uuid(), name: "gettickler.com domain", amount: 12.5, currency: "USD", interval: "yearly", renews_on: today(40 * DAY), project_id: proj("tickler-launch").id },
    { id: uuid(), name: "Hetzner VPS", amount: 5.39, currency: "USD", interval: "monthly", renews_on: today(12 * DAY), project_id: proj("home-server").id },
    { id: uuid(), name: "Cloudflare Workers Paid", amount: 5, currency: "USD", interval: "monthly", renews_on: today(21 * DAY), project_id: null },
  ].map((f) => ({ ...f, created_at: now(-55 * DAY), updated_at: now(-55 * DAY), rev: nextRev() }));

  return {
    cursor: String(rev),
    has_more: false,
    projects,
    entries,
    origins,
    budgets,
    alerts,
    metric_snapshots,
    sales_events,
    fixed_costs,
    deleted: [],
  };
}

const PLACEHOLDER = /^__(NOW|TODAY|MONTH|MONTH_START|MONTH_END)__(?:([+-])P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?)?$/;

/** Resolve one placeholder to an ISO instant (UTC), or null if the value isn't a placeholder. */
export function resolvePlaceholder(value: string, nowDate: Date): Date | null {
  const m = PLACEHOLDER.exec(value);
  if (!m) return null;
  const base = new Date(Math.floor(nowDate.getTime() / 60000) * 60000);
  const [, kind, sign, d, h, mi] = m;
  if (kind === "TODAY") base.setUTCHours(0, 0, 0, 0);
  if (kind === "MONTH" || kind === "MONTH_START") base.setUTCHours(0, 0, 0, 0), base.setUTCDate(1);
  if (kind === "MONTH_END") base.setUTCHours(0, 0, 0, 0), base.setUTCMonth(base.getUTCMonth() + 1, 0);
  const mins = (Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(mi ?? 0)) * (sign === "-" ? -1 : 1);
  return new Date(base.getTime() + mins * 60000);
}

const DATE_FIELDS = new Set(["period_start", "period_end", "renews_on"]);

/** Deep-resolve every placeholder in a demo document. Date fields become YYYY-MM-DD, `month` becomes YYYY-MM. */
export function resolveDemo<T>(doc: T, nowDate = new Date()): T {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === "string") {
      const d = resolvePlaceholder(v, nowDate);
      if (!d) return v;
      const iso = d.toISOString();
      if (key === "month") return iso.slice(0, 7);
      if (DATE_FIELDS.has(key)) return iso.slice(0, 10);
      return iso;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(doc, "") as T;
}
