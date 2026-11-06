import { describe, expect, it } from "vitest";
import { aws } from "../../src/providers/aws";
import { signedJsonPost } from "../../src/providers/sigv4";
import { ctx, fixture, headerOf, json, mockFetch } from "./helpers";

const cfg = { access_key_id: "AKIDEXAMPLE", secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

function ce(forecast: () => Response) {
  return mockFetch([
    [
      "ce.us-east-1.amazonaws.com",
      (_url, init) => (headerOf(init, "x-amz-target")!.endsWith("GetCostForecast") ? forecast() : json(fixture("aws/cost_and_usage.json"))),
    ],
  ]);
}

describe("aws", () => {
  it("syncs every 6 hours at most", () => {
    expect(aws.syncEveryMinutes).toBeGreaterThanOrEqual(360);
  });

  it("sums service groups per day and adds the forecast to what is spent", async () => {
    const m = ce(() => json(fixture("aws/forecast.json")));
    const { snapshots } = await aws.sync(cfg, ctx(m.fetch));
    expect(snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-04")?.value).toBeCloseTo(1.7345);
    expect(snapshots.find((s) => s.label === "AWS Lambda" && s.period_start === "2026-11-05")?.value).toBe(0.25);
    const f = snapshots.find((s) => s.metric === "forecast")!;
    expect(f.period_start).toBe("2026-11-01");
    expect(f.period_end).toBe("2026-11-30");
    expect(f.value).toBeCloseTo(1.7345 + 0.25 + 20.5);
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.TimePeriod).toEqual({ Start: "2026-10-29", End: "2026-11-07" });
    expect(m.calls).toHaveLength(2);
  });

  it("skips the forecast when AWS has too little data", async () => {
    const m = ce(() => json({ __type: "com.amazonaws.ce#DataUnavailableException", Message: "Insufficient amount of historical data" }, 400));
    const { snapshots } = await aws.sync(cfg, ctx(m.fetch));
    expect(snapshots.some((s) => s.metric === "forecast")).toBe(false);
  });

  it("signs requests with SigV4", async () => {
    const { init } = await signedJsonPost({
      creds: { accessKeyId: cfg.access_key_id, secretAccessKey: cfg.secret_access_key },
      region: "us-east-1",
      service: "ce",
      host: "ce.us-east-1.amazonaws.com",
      target: "AWSInsightsIndexService.GetCostAndUsage",
      body: "{}",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    const auth = headerOf(init, "authorization")!;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261106\/us-east-1\/ce\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
    expect(headerOf(init, "x-amz-date")).toBe("20261106T120000Z");
  });

  it("matches the AWS SigV4 reference signature", async () => {
    // Known answer computed independently with Node's crypto (HMAC chain), see below.
    const { createHash, createHmac } = await import("node:crypto");
    const body = '{"a":1}';
    const { init } = await signedJsonPost({
      creds: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      region: "us-east-1",
      service: "ce",
      host: "ce.us-east-1.amazonaws.com",
      target: "T",
      body,
      now: new Date("2026-01-02T03:04:05Z"),
    });
    const canonical = ["POST", "/", "", "content-type:application/x-amz-json-1.1\nhost:ce.us-east-1.amazonaws.com\nx-amz-date:20260102T030405Z\nx-amz-target:T\n", "content-type;host;x-amz-date;x-amz-target", createHash("sha256").update(body).digest("hex")].join("\n");
    const sts = ["AWS4-HMAC-SHA256", "20260102T030405Z", "20260102/us-east-1/ce/aws4_request", createHash("sha256").update(canonical).digest("hex")].join("\n");
    let k: Buffer = createHmac("sha256", "AWS4SECRET").update("20260102").digest();
    for (const p of ["us-east-1", "ce", "aws4_request"]) k = createHmac("sha256", k).update(p).digest();
    const sig = createHmac("sha256", k).update(sts).digest("hex");
    expect(headerOf(init, "authorization")).toContain(`Signature=${sig}`);
  });

  it("test explains a denied policy", async () => {
    const m = mockFetch([["ce.us-east-1", () => json({ __type: "AccessDeniedException", Message: "User is not authorized to perform: ce:GetCostAndUsage" }, 400)]]);
    const r = await aws.test(cfg, ctx(m.fetch));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("AccessDeniedException");
  });
});
