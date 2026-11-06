// Connect a money source from your computer instead of pasting keys on a phone.
//
//   TICKLER_SECRET=... npm run provider -- set aws creds.json            # Cloudflare (D1 "tickler")
//   TICKLER_SECRET=... npm run provider -- set aws creds.json --db /data/tickler.sqlite   # Docker/Node
//   TICKLER_SECRET=... npm run provider -- test aws creds.json
//
// creds.json is an object of the provider's fields (see GET /api/money/providers → fields). A field
// whose value starts with "@" is read from that file, e.g. { "private_key": "@AuthKey_X.p8" }.
// The credentials are tested against the provider first, then encrypted with TICKLER_SECRET the
// same way the server does, and written to your database. Nothing is sent anywhere else.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { encryptJson } from "../src/core/crypto";
import { getProvider } from "../src/providers";
import type { ProviderConfig, ProviderId } from "../src/providers/types";

const [cmd, id, file, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: npm run provider -- set|test <provider> <creds.json> [--db <sqlite file>] [--d1 <database name>]");
  process.exit(1);
  throw new Error("unreachable");
}

if ((cmd !== "set" && cmd !== "test") || !id || !file) usage();
const provider = getProvider(id as ProviderId);
if (!provider) usage(`unknown provider "${id}"`);

const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const cfg: ProviderConfig = {};
for (const [k, v] of Object.entries(raw)) {
  if (v === null || v === undefined || v === "") continue;
  const s = String(v);
  cfg[k] = s.startsWith("@") ? readFileSync(resolve(dirname(file), s.slice(1)), "utf8").trim() : s;
}
const unknown = Object.keys(cfg).filter((k) => !provider.fields.some((f) => f.key === k));
if (unknown.length) usage(`unknown field(s) for ${id}: ${unknown.join(", ")}`);
if (!provider.configured(cfg)) usage(`missing required fields for ${id}: ${provider.fields.filter((f) => !f.optional && !cfg[f.key]).map((f) => f.key).join(", ")}`);

const result = await provider.test(cfg, { now: new Date(), fetch, lastSyncAt: null, currency: process.env.TICKLER_CURRENCY ?? "USD" });
console.log(`${provider.displayName}: ${result.ok ? "OK" : "FAILED"}, ${result.message}`);
if (!result.ok) process.exit(2);
if (cmd === "test") process.exit(0);

const secret = process.env.TICKLER_SECRET;
if (!secret) usage("set TICKLER_SECRET to the server's secret");
const enc = await encryptJson(secret, cfg);
const now = new Date().toISOString();
const summary = `Saved ${id} credentials (${Object.keys(cfg).length} fields) from the command line`;
const sql = `INSERT INTO provider_configs (provider, credentials_enc, enabled, updated_at) VALUES ('${id}', '${enc}', 1, '${now}')
  ON CONFLICT (provider) DO UPDATE SET credentials_enc = excluded.credentials_enc, enabled = 1, updated_at = excluded.updated_at, last_error = NULL;
INSERT INTO activity (id, at, actor_type, actor_id, actor_name, origin_id, action, summary)
  VALUES ('${randomUUID()}', '${now}', 'admin', NULL, 'command line', NULL, 'PUT /api/money/providers/${id}', '${summary}');`;

const dbFile = flag("--db");
if (dbFile) {
  const { DatabaseSync } = await import("node:sqlite");
  new DatabaseSync(dbFile).exec(sql);
} else {
  execFileSync("npx", ["wrangler", "d1", "execute", flag("--d1") ?? "tickler", "--remote", "--command", sql], { stdio: ["ignore", "ignore", "inherit"] });
}
console.log(`Saved. The server syncs ${provider.displayName} within ${provider.syncEveryMinutes} minutes, or tap Sync now in the app.`);
