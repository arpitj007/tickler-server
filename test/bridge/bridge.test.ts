// End to end: a real HTTP server, the real `tickler` CLI, and fake `claude` and `t3` binaries that
// record their arguments and stdin.
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, setupAll, tool } from "../core/helpers";

const CLI = join(__dirname, "../../packages/tickler/bin/tickler.mjs");
const T3_THREAD = "6b0e3f0a-1111-4222-8333-944455556666";

let server: ServerType;
let base: string;
let home: string;
let bridge: ChildProcess | null = null;
let t: ReturnType<typeof makeApp>;
let s: Awaited<ReturnType<typeof setupAll>>;

function fakeBin(dir: string, name: string, stdout: string) {
  const p = join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require("fs");
if (process.argv[2] === "--version") { console.log("${name} 9.9.9"); process.exit(0); }
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(join(dir, `${name}.calls`))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input }) + "\\n");
  process.stdout.write(${JSON.stringify(stdout)}.replace("INPUT", JSON.stringify(input).slice(1, -1)));
});
`,
  );
  chmodSync(p, 0o755);
}

const calls = (name: string) =>
  readFileSync(join(home, "bin", `${name}.calls`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; cwd: string; input: string });

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const run = promisify(execFile);
const env = () => ({ ...process.env, HOME: home, PATH: `${join(home, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin` });

beforeAll(async () => {
  t = makeApp();
  s = await setupAll(t);
  server = serve({ fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  home = mkdtempSync(join(tmpdir(), "tickler-bridge-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "dev", "app"), { recursive: true });
  fakeBin(join(home, "bin"), "claude", '{"type":"result","subtype":"success","is_error":false,"result":"echo: INPUT","session_id":"sess-new","permission_denials":[]}');
  fakeBin(join(home, "bin"), "t3", `{"threadId":"${T3_THREAD}"}`);
});

afterAll(() => {
  bridge?.kill();
  server?.close();
  rmSync(home, { recursive: true, force: true });
});

describe("tickler bridge", () => {
  it("pairs with a code from the phone, then runs dispatches with the message on stdin", async () => {
    const code = (await (await t.req("/api/bridge-codes", { method: "POST", token: s.device })).json()).code as string;
    const { stdout: out } = await run(process.execPath, [CLI, "bridge", "install", "--server", base, "--code", code, "--no-service"], { env: env() });
    expect(out).toContain("Paired with");
    expect(out).toContain("Claude Code 9.9.9");
    const cfgPath = join(home, ".tickler", "bridge.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(cfg.token).toMatch(/^tkb_/);
    expect((execFileSync("stat", process.platform === "darwin" ? ["-f", "%Lp", cfgPath] : ["-c", "%a", cfgPath]) + "").trim()).toBe("600");

    execFileSync(process.execPath, [CLI, "bridge", "map", "p1", "--cwd", join(home, "dev", "app"), "--client", "claude_code"], { env: env() });
    bridge = spawn(process.execPath, [CLI, "bridge"], { env: env(), stdio: "ignore" });

    const listed = await until(async () => {
      const b = (await (await t.req("/api/bridges", { token: s.device })).json()).bridges as any[];
      return b.find((x) => x.runners.length === 2 && x.projects.length === 1);
    });
    expect(listed.runners.map((r: { client: string }) => r.client).sort()).toEqual(["claude_code", "t3_code"]);
    expect(listed.projects[0]).toMatchObject({ project_id: "p1", client: "claude_code" });

    // A new Claude Code session in the mapped folder.
    const id = crypto.randomUUID();
    const message = 'Build the paywall. Use "quotes" and $HOME literally; `rm -rf /` stays text.';
    const created = await t.req("/api/dispatches", {
      method: "POST",
      token: s.device,
      json: { id, project_id: "p1", message, new_session: { client: "claude_code", cwd: listed.projects[0].cwd } },
    });
    expect(created.status).toBe(201);
    const done = await until(async () => {
      const d = (await (await t.req(`/api/dispatches/${id}`, { token: s.device })).json()).dispatch;
      return d.status === "done" && d;
    });
    expect(done.detail).toBe(`echo: ${message}`);
    expect(done.session_id).toBe("sess-new");
    const call = calls("claude")[0]!;
    expect(call.args).toEqual(["-p", "--output-format", "json"]);
    expect(call.input).toBe(message);
    expect(call.args.join(" ")).not.toMatch(/dangerously|yolo|bypass|--force/);

    // Resume a T3 thread an agent recorded.
    const entry = await tool(t, s.mcp, "create_entry", {
      project: "Tickler",
      title: "x",
      origin: { client: "t3_code", session_id: T3_THREAD, machine: (await import("node:os")).hostname() },
    });
    const id2 = crypto.randomUUID();
    await t.req("/api/dispatches", {
      method: "POST",
      token: s.device,
      json: { id: id2, message: "Next step", origin_id: entry.data.entry.origin_id },
    });
    const sent = await until(async () => {
      const d = (await (await t.req(`/api/dispatches/${id2}`, { token: s.device })).json()).dispatch;
      return d.status === "sent" && d;
    });
    expect(sent.detail).toContain("next turn");
    expect(calls("t3")[0]).toMatchObject({ args: ["thread", "send", "--json", T3_THREAD, "-"], input: "Next step" });

    // A folder outside the bridge's roots never runs.
    const id3 = crypto.randomUUID();
    await t.req("/api/dispatches", {
      method: "POST",
      token: s.device,
      json: { id: id3, message: "x", new_session: { client: "claude_code", cwd: "/" } },
    });
    const failed = await until(async () => {
      const d = (await (await t.req(`/api/dispatches/${id3}`, { token: s.device })).json()).dispatch;
      return d.status === "failed" && d;
    });
    expect(failed.detail).toContain("isn't under a folder the bridge may use");
    expect(calls("claude")).toHaveLength(1);
  }, 60_000);
});
