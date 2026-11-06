import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearGoogleTokenCache } from "../../src/providers/google";
import { googleCloud } from "../../src/providers/google_cloud";
import { ctx, fixture, json, mockFetch } from "./helpers";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = JSON.stringify({ client_email: "tickler@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), private_key_id: "k1" });
const cfg = { service_account_json: sa, bigquery_table: "example-project.billing.gcp_billing_export_v1_000000_000000_000000", billing_account_id: "000000-000000-000000" };

function routes() {
  return mockFetch([
    ["oauth2.googleapis.com/token", () => json({ access_token: "ya29.test", expires_in: 3600, token_type: "Bearer" })],
    ["/queries", () => json(fixture("google_cloud/query.json"))],
    ["billingbudgets.googleapis.com", () => json(fixture("google_cloud/budgets.json"))],
  ]);
}

describe("google_cloud", () => {
  beforeEach(() => clearGoogleTokenCache());

  it("queries the billing export with a parameter and maps daily net cost", async () => {
    const m = routes();
    const { snapshots } = await googleCloud.sync(cfg, ctx(m.fetch));
    expect(snapshots.find((s) => s.label == null && s.period_start === "2026-11-04")?.value).toBe(5);
    expect(snapshots.find((s) => s.label == null && s.period_start === "2026-11-05")?.value).toBe(-0.25);
    expect(snapshots.find((s) => s.label === "Compute Engine" && s.period_start === "2026-11-04")?.value).toBe(4.5);
    const q = JSON.parse(String(m.calls.find((c) => c.url.includes("/queries"))!.init.body));
    expect(q.useLegacySql).toBe(false);
    expect(q.queryParameters[0].parameterValue.value).toBe("2026-10-29");
    expect(q.query).toContain("`example-project.billing.gcp_billing_export_v1_000000_000000_000000`");
    expect((snapshots.find((s) => s.label == null && s.period_start === "2026-11-05")?.raw as any).budgets[0]).toEqual({ name: "Monthly", amount: 100, currency: "USD", thresholds: [0.5, 0.9] });
    const assertion = new URLSearchParams(String(m.calls[0].init.body)).get("assertion")!;
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
    expect(claims.scope).toContain("bigquery.readonly");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
  });

  it("rejects a table name that could inject SQL", async () => {
    const r = await googleCloud.test({ ...cfg, bigquery_table: "a.b.c` WHERE 1=1; --" }, ctx(routes().fetch));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("project.dataset");
  });

  it("test counts budgets", async () => {
    const r = await googleCloud.test(cfg, ctx(routes().fetch));
    expect(r).toEqual({ ok: true, message: "Connected: the billing export table is readable. 1 budget(s) found." });
  });
});
