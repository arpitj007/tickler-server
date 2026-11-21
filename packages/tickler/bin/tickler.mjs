#!/usr/bin/env node
// Tickler command line. `tickler bridge` runs on the computer your AI agents use: it pairs with your
// Tickler server, long-polls for prompts you send from the phone ("Run in agent"), and hands each one
// to the agent's own CLI with the message on stdin. The runner table below is built in: the server
// sends messages, never commands. Contract: docs/reference/api-contract.md, "Run in agent".
// No dependencies, so `npx tickler` starts fast and the installed copy can't break on an update.
import { spawn, execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const HOME = homedir();
const DIR = join(HOME, ".tickler");
const CONFIG = join(DIR, "bridge.json");
const INSTALLED = join(DIR, "bridge", "tickler.mjs");
const LOG = join(DIR, "bridge.log");
const LABEL = "com.gettickler.bridge";
const PLIST = join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const UNIT = join(HOME, ".config", "systemd", "user", "tickler-bridge.service");
const HEARTBEAT_MS = 30_000;
const WAIT_S = 25;
const MAX_RUNNING = 3;
const DETAIL_MAX = 2000;

// ---------- runners

/**
 * How each harness takes a message for an existing session (`resume`) or a new one in a folder
 * (`start`). The message always goes in on stdin. Never add permission-skipping flags: the
 * session's own settings decide what the agent may do.
 * Checked against: t3 0.1.3 (`t3 thread send|start --help`), Claude Code 2.1.308, codex-cli 0.171.0,
 * gemini 0.70.0 (2026-11-22).
 */
const RUNNERS = {
  t3_code: {
    label: "T3 Code",
    bins: ["t3"],
    // T3 queues the message as the thread's next turn and never interrupts it, so `sent` is final.
    queues: true,
    resume: (d) => ["thread", "send", "--json", d.session_id, "-"],
    start: (d) => ["thread", "start", "--json", d.cwd, "-"],
    parse: parseT3,
  },
  claude_code: {
    label: "Claude Code",
    bins: ["claude"],
    // Claude Code finds a session by id within the folder it was started in.
    resumeNeedsCwd: true,
    resume: (d) => ["-p", "--resume", d.session_id, "--output-format", "json"],
    start: () => ["-p", "--output-format", "json"],
    parse: parseClaude,
  },
  codex: {
    label: "Codex",
    bins: ["codex"],
    resume: (d) => ["exec", "--json", "resume", d.session_id, "-"],
    start: (d) => ["exec", "--json", "-C", d.cwd, "-"],
    parse: parseCodex,
  },
  gemini_cli: {
    label: "Gemini CLI",
    bins: ["gemini"],
    // Off unless enabled in bridge.json: `gemini --resume` takes "latest" or a list index, not a
    // session id, so only new sessions work, and reading the whole prompt from stdin isn't verified.
    optIn: true,
    resume: null,
    start: () => ["--output-format", "json", "--prompt", ""],
    parse: parseGemini,
  },
  // Cursor's CLI takes the prompt as an argument; its docs don't say it reads stdin, and the bridge
  // never puts a message in argv. Add it once that's confirmed.
};

const EXTRA_DIRS = [join(HOME, ".t3", "bin"), join(HOME, ".local", "bin"), join(HOME, ".npm-global", "bin"), join(HOME, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

function findBin(client, cfg) {
  const own = cfg.runners?.[client]?.path;
  if (own) return isExecutable(own) ? own : null;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), ...EXTRA_DIRS].filter(Boolean);
  for (const name of RUNNERS[client].bins) {
    for (const dir of dirs) {
      const p = join(dir, name);
      if (isExecutable(p)) return p;
    }
  }
  return null;
}

function isExecutable(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function binVersion(bin) {
  try {
    const out = execFileSync(bin, ["--version"], { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /\d+\.\d+(\.\d+)?/.exec(out)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** The runners this computer offers: CLI found, and enabled (opt-in runners need `enabled: true`). */
function availableRunners(cfg) {
  const out = [];
  for (const [client, r] of Object.entries(RUNNERS)) {
    const setting = cfg.runners?.[client]?.enabled;
    if (setting === false || (r.optIn && setting !== true)) continue;
    const bin = findBin(client, cfg);
    if (bin) out.push({ client, bin, version: binVersion(bin) });
  }
  return out;
}

// ---------- config

function machine() {
  return hostname();
}

function computerName() {
  if (platform() === "darwin") {
    try {
      return execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 3000 }).trim();
    } catch {}
  }
  return hostname();
}

function loadConfig() {
  if (!existsSync(CONFIG)) return { roots: [HOME], runners: {}, projects: [] };
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
  cfg.roots = (cfg.roots?.length ? cfg.roots : [HOME]).map(expand);
  cfg.runners ??= {};
  cfg.projects ??= [];
  return cfg;
}

function saveConfig(cfg) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, CONFIG);
  chmodSync(CONFIG, 0o600);
}

const expand = (p) => (p === "~" ? HOME : p.startsWith("~/") ? join(HOME, p.slice(2)) : p);

/** A folder the bridge may run in: it exists and is inside one of the configured roots. */
function allowedCwd(cfg, cwd) {
  if (!cwd || !isAbsolute(cwd)) return null;
  let real;
  try {
    real = realpathSync(cwd);
  } catch {
    return null;
  }
  for (const root of cfg.roots) {
    let r;
    try {
      r = realpathSync(root);
    } catch {
      continue;
    }
    if (real === r || real.startsWith(r.endsWith(sep) ? r : r + sep)) return real;
  }
  return null;
}

// ---------- server

async function api(cfg, method, path, body, timeoutMs = 20_000) {
  const res = await fetch(`${cfg.server}${path}`, {
    method,
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", "user-agent": `tickler-bridge/${VERSION}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return { status: 204, body: null };
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: json, text };
}

function heartbeatBody(cfg, runners) {
  const offered = new Set(runners.map((r) => r.client));
  return {
    machine: machine(),
    name: computerName(),
    version: VERSION,
    runners: runners.map(({ client, version }) => ({ client, version })),
    projects: cfg.projects
      .filter((p) => allowedCwd(cfg, expand(p.cwd)) && (!p.client || offered.has(p.client)))
      .map((p) => ({ project_id: p.project_id, cwd: expand(p.cwd), client: p.client ?? null })),
  };
}

// ---------- running a dispatch

function tail(s, n = DETAIL_MAX) {
  s = (s ?? "").trim();
  return s.length > n ? "…" + s.slice(-(n - 1)) : s;
}

function lastJson(stdout) {
  const t = stdout.trim();
  try {
    return JSON.parse(t);
  } catch {}
  const lines = t.split("\n").reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l);
    } catch {}
  }
  return null;
}

function parseT3(out, isNew) {
  if (out.code !== 0) return { status: "failed", detail: tail(out.stderr || out.stdout) };
  const j = lastJson(out.stdout);
  const id = j && (j.threadId ?? j.thread_id ?? j.thread?.id ?? j.id);
  const fromText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(out.stdout)?.[0];
  const sessionId = isNew ? (typeof id === "string" ? id : fromText) ?? null : null;
  return { status: "sent", detail: isNew ? "Started a new T3 Code thread." : "Sent. T3 Code runs it as the thread's next turn.", session_id: sessionId };
}

function parseClaude(out, isNew) {
  const j = lastJson(out.stdout);
  if (!j) return { status: "failed", detail: tail(out.stderr || out.stdout || `claude exited with ${out.code}`) };
  const sessionId = isNew ? j.session_id ?? null : null;
  const reply = typeof j.result === "string" ? j.result : "";
  if (j.is_error || (j.subtype && j.subtype !== "success") || out.code !== 0) {
    return { status: "failed", detail: tail(reply || out.stderr || j.subtype || "Claude Code stopped with an error"), session_id: sessionId };
  }
  const denied = Array.isArray(j.permission_denials) ? j.permission_denials : [];
  if (denied.length) {
    const tools = [...new Set(denied.map((x) => x.tool_name).filter(Boolean))].join(", ");
    return { status: "needs_input", detail: tail(`Waiting for permission to use ${tools || "a tool"}. Open the session to answer.\n\n${reply}`), session_id: sessionId };
  }
  return { status: "done", detail: tail(reply), session_id: sessionId };
}

function parseCodex(out, isNew) {
  let threadId = null;
  let reply = "";
  let error = null;
  for (const line of out.stdout.split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "thread.started" && e.thread_id) threadId = e.thread_id;
    if (e.type === "item.completed" && e.item?.type === "agent_message" && typeof e.item.text === "string") reply = e.item.text;
    if (e.type === "turn.failed" || e.type === "error") error = e.error?.message ?? e.message ?? "Codex reported an error";
  }
  const sessionId = isNew ? threadId : null;
  if (error || out.code !== 0) return { status: "failed", detail: tail(error || out.stderr || `codex exited with ${out.code}`), session_id: sessionId };
  return { status: "done", detail: tail(reply), session_id: sessionId };
}

function parseGemini(out) {
  const j = lastJson(out.stdout);
  if (out.code !== 0 || !j || j.error) return { status: "failed", detail: tail(j?.error?.message || out.stderr || out.stdout) };
  return { status: "done", detail: tail(typeof j.response === "string" ? j.response : ""), session_id: j.session_id ?? null };
}

function runProcess(bin, args, { cwd, input, timeoutMs }) {
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    const cap = (s, chunk) => (s + chunk).slice(-2_000_000);
    child.stdout.on("data", (c) => (stdout = cap(stdout, c.toString())));
    child.stderr.on("data", (c) => (stderr = cap(stderr, c.toString())));
    const timer = setTimeout(() => {
      stderr += `\nStopped after ${Math.round(timeoutMs / 60000)} minutes.`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr: String(e.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function report(cfg, id, result) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await api(cfg, "POST", `/api/dispatches/${encodeURIComponent(id)}/result`, result);
      if (r.status < 500) return;
    } catch {}
    await sleep(2000 * (i + 1));
  }
  log(`could not report ${result.status} for ${id}`);
}

async function runDispatch(cfg, runners, d) {
  const runner = RUNNERS[d.client];
  const available = runners.find((r) => r.client === d.client);
  if (!runner || !available) return report(cfg, d.id, { status: "failed", detail: `This computer doesn't run ${d.client} right now.` });
  const isNew = !d.origin_id;
  if (!isNew && !d.session_id) return report(cfg, d.id, { status: "failed", detail: "The session has no id to resume." });
  if (!isNew && !runner.resume) return report(cfg, d.id, { status: "failed", detail: `${runner.label} can't resume a session by id. Start a new one instead.` });
  let cwd = null;
  if (d.cwd) {
    cwd = allowedCwd(cfg, d.cwd);
    if (!cwd) return report(cfg, d.id, { status: "failed", detail: `${d.cwd} doesn't exist on this computer or isn't under a folder the bridge may use (roots in ~/.tickler/bridge.json).` });
  } else if (isNew || runner.resumeNeedsCwd) {
    return report(cfg, d.id, { status: "failed", detail: `${runner.label} needs the session's folder, and Tickler doesn't know it.` });
  }
  const args = isNew ? runner.start({ ...d, cwd }) : runner.resume({ ...d, cwd });
  if (!runner.queues) await report(cfg, d.id, { status: "running" });
  log(`${d.id}: ${runner.label} ${isNew ? "new session" : "resume"} in ${cwd ?? HOME}`);
  const timeoutMs = runner.queues ? 120_000 : (cfg.timeout_minutes ?? 60) * 60_000;
  const out = await runProcess(available.bin, args, { cwd: cwd ?? HOME, input: d.message, timeoutMs });
  const result = runner.parse(out, isNew);
  if (!result.session_id) delete result.session_id;
  log(`${d.id}: ${result.status}`);
  return report(cfg, d.id, result);
}

// ---------- the bridge loop

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

async function bridge() {
  let cfg = loadConfig();
  if (!cfg.server || !cfg.token) {
    console.error("This computer isn't paired yet. Run: npx tickler bridge install");
    process.exit(1);
  }
  let runners = availableRunners(cfg);
  log(`tickler bridge ${VERSION} for ${cfg.server} on ${machine()}: ${runners.map((r) => r.client).join(", ") || "no agent CLIs found"}`);
  let removed = false;
  const beat = async () => {
    try {
      cfg = loadConfig();
      runners = availableRunners(cfg);
      const r = await api(cfg, "POST", "/api/bridge/heartbeat", heartbeatBody(cfg, runners));
      removed = r.status === 401;
      if (r.status >= 300) log(`heartbeat: HTTP ${r.status} ${r.body?.error?.message ?? ""}`);
    } catch (e) {
      log(`heartbeat: ${e.message}`);
    }
  };
  await beat();
  setInterval(beat, HEARTBEAT_MS);
  let running = 0;
  let backoff = 1000;
  for (;;) {
    if (removed) {
      log("This bridge was removed in the app. Run `npx tickler bridge install` to pair again.");
      await sleep(5 * 60_000);
      await beat();
      continue;
    }
    if (running >= MAX_RUNNING) {
      await sleep(1000);
      continue;
    }
    try {
      const r = await api(cfg, "GET", `/api/bridge/next?wait=${WAIT_S}`, undefined, (WAIT_S + 15) * 1000);
      backoff = 1000;
      if (r.status === 200 && r.body?.dispatch) {
        running++;
        runDispatch(cfg, runners, r.body.dispatch)
          .catch((e) => log(`run failed: ${e.message}`))
          .finally(() => running--);
      } else if (r.status === 401) {
        removed = true;
      } else if (r.status !== 204) {
        log(`next: HTTP ${r.status} ${r.body?.error?.message ?? ""}`);
        await sleep(5000);
      }
    } catch (e) {
      log(`next: ${e.message}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

// ---------- install, status, map

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

async function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(q)).trim();
  } finally {
    rl.close();
  }
}

async function pair(cfg, server, code) {
  server = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(server)) server = `https://${server}`;
  const res = await fetch(`${server}/api/bridge/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, machine: machine(), name: computerName() }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 201 || !body?.token) throw new Error(body?.error?.message ?? `Pairing failed: HTTP ${res.status}`);
  return { ...cfg, server, token: body.token, bridge_id: body.bridge_id };
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function servicePath() {
  const dirs = [dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter), ...EXTRA_DIRS, "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(dirs.filter(Boolean))].join(delimiter);
}

function installService() {
  mkdirSync(dirname(INSTALLED), { recursive: true, mode: 0o700 });
  copyFileSync(fileURLToPath(import.meta.url), INSTALLED);
  chmodSync(INSTALLED, 0o755);
  const args = [process.execPath, INSTALLED, "bridge"];
  if (platform() === "darwin") {
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(
      PLIST,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(servicePath())}</string><key>HOME</key><string>${xml(HOME)}</string></dict>
  <key>WorkingDirectory</key><string>${xml(HOME)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`,
    );
    const domain = `gui/${userInfo().uid}`;
    try {
      execFileSync("launchctl", ["bootout", domain, PLIST], { stdio: "ignore" });
    } catch {}
    execFileSync("launchctl", ["bootstrap", domain, PLIST], { stdio: "inherit" });
    // RunAtLoad after bootstrap can be left pending ("speculative"); start it now.
    execFileSync("launchctl", ["kickstart", `${domain}/${LABEL}`], { stdio: "ignore" });
    return `launchd (${PLIST})`;
  }
  if (platform() === "linux") {
    mkdirSync(dirname(UNIT), { recursive: true });
    const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    writeFileSync(
      UNIT,
      `[Unit]
Description=Tickler bridge: runs prompts from the Tickler app in your agents' sessions
After=network-online.target

[Service]
ExecStart=${args.map(q).join(" ")}
Environment=${q(`PATH=${servicePath()}`)}
WorkingDirectory=${HOME}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`,
    );
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", "tickler-bridge.service"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "restart", "tickler-bridge.service"], { stdio: "inherit" });
    return `systemd (${UNIT}). To keep it running while you're logged out: loginctl enable-linger ${userInfo().username}`;
  }
  return null;
}

function uninstallService() {
  if (platform() === "darwin" && existsSync(PLIST)) {
    try {
      execFileSync("launchctl", ["bootout", `gui/${userInfo().uid}`, PLIST], { stdio: "ignore" });
    } catch {}
    rmSync(PLIST);
  }
  if (platform() === "linux" && existsSync(UNIT)) {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", "tickler-bridge.service"], { stdio: "ignore" });
    } catch {}
    rmSync(UNIT);
  }
  rmSync(dirname(INSTALLED), { recursive: true, force: true });
}

async function install(args) {
  let cfg = loadConfig();
  const server = flag(args, "server");
  const code = flag(args, "code");
  if (code || !cfg.token) {
    const s = server ?? cfg.server ?? (await ask("Tickler server address (from the app, Settings): "));
    const c = code ?? (await ask("Setup code (in the app: Run with AI, Set up this computer): "));
    cfg = await pair(cfg, s, c);
    cfg.roots ??= [HOME];
    saveConfig(cfg);
    console.log(`Paired with ${cfg.server} as ${computerName()}.`);
  }
  const runners = availableRunners(cfg);
  console.log(
    runners.length
      ? `Agents found: ${runners.map((r) => `${RUNNERS[r.client].label}${r.version ? ` ${r.version}` : ""}`).join(", ")}.`
      : "No agent CLIs found yet (t3, claude, codex). Install one; the bridge picks it up within a minute.",
  );
  const r = await api(cfg, "POST", "/api/bridge/heartbeat", heartbeatBody(cfg, runners));
  if (r.status !== 200) throw new Error(r.body?.error?.message ?? `The server answered HTTP ${r.status}`);
  if (args.includes("--no-service")) {
    console.log("Run `npx tickler bridge` to start it.");
    return;
  }
  const where = installService();
  if (where) console.log(`Running in the background with ${where}. Log: ${LOG}`);
  else console.log("Start it with `npx tickler bridge` and keep it running (no launchd or systemd here).");
  console.log("Your phone now shows this computer under Run with AI.");
}

async function status() {
  const cfg = loadConfig();
  console.log(`Config: ${CONFIG}${existsSync(CONFIG) ? "" : " (not paired)"}`);
  if (cfg.server) console.log(`Server: ${cfg.server}`);
  console.log(`Machine: ${machine()} (${computerName()})`);
  console.log(`Folders it may run in: ${cfg.roots.join(", ")}`);
  for (const [client, r] of Object.entries(RUNNERS)) {
    const bin = findBin(client, cfg);
    const setting = cfg.runners?.[client]?.enabled;
    const on = bin && setting !== false && (!r.optIn || setting === true);
    console.log(`  ${r.label}: ${on ? `on (${bin})` : bin ? "off" : "not found"}${r.optIn && bin && !on ? " (opt in with runners.gemini_cli.enabled)" : ""}`);
  }
  for (const p of cfg.projects) console.log(`  project ${p.project_id} → ${p.cwd}${p.client ? ` (${p.client})` : ""}`);
  console.log(`Service: ${existsSync(PLIST) || existsSync(UNIT) ? "installed" : "not installed"}`);
  if (cfg.token) {
    try {
      const r = await api(cfg, "POST", "/api/bridge/heartbeat", heartbeatBody(cfg, availableRunners(cfg)));
      console.log(`Server check: ${r.status === 200 ? "ok" : `HTTP ${r.status} ${r.body?.error?.message ?? ""}`}`);
    } catch (e) {
      console.log(`Server check: ${e.message}`);
    }
  }
}

function map(args) {
  const projectId = args[0];
  if (!projectId || projectId.startsWith("--")) throw new Error("Usage: tickler bridge map <project-id> [--cwd <folder>] [--client t3_code|claude_code|codex]");
  const cfg = loadConfig();
  const cwd = resolve(expand(flag(args, "cwd") ?? process.cwd()));
  const client = flag(args, "client") ?? null;
  if (client && !RUNNERS[client]) throw new Error(`Unknown client ${client}. Use one of: ${Object.keys(RUNNERS).join(", ")}`);
  if (!allowedCwd(cfg, cwd)) throw new Error(`${cwd} doesn't exist or isn't under ${cfg.roots.join(", ")}`);
  cfg.projects = cfg.projects.filter((p) => p.project_id !== projectId).concat([{ project_id: projectId, cwd, client }]);
  saveConfig(cfg);
  console.log(`New sessions for project ${projectId} start in ${cwd}${client ? ` with ${client}` : ""}.`);
}

function unmap(args) {
  const cfg = loadConfig();
  cfg.projects = cfg.projects.filter((p) => p.project_id !== args[0]);
  saveConfig(cfg);
}

const HELP = `tickler ${VERSION}

  tickler bridge install [--server <url> --code <code>]   pair this computer and run the bridge in the background
  tickler bridge                                          run the bridge in the foreground
  tickler bridge status                                   show pairing, agents found and projects
  tickler bridge map <project-id> [--cwd .] [--client c]  start new sessions for a project in a folder
  tickler bridge unmap <project-id>
  tickler bridge uninstall                                stop it and remove the background service

Config: ~/.tickler/bridge.json (roots, runners, projects). Docs: https://github.com/arpitj007/tickler-server
`;

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") return console.log(VERSION);
  if (cmd !== "bridge") return console.log(HELP);
  if (!sub || sub.startsWith("--")) return bridge();
  if (sub === "install") return install(rest);
  if (sub === "status") return status();
  if (sub === "map") return map(rest);
  if (sub === "unmap") return unmap(rest);
  if (sub === "uninstall") {
    uninstallService();
    console.log("Stopped and removed the background service. Your pairing stays in ~/.tickler/bridge.json; remove the computer in the app to revoke it.");
    return;
  }
  console.log(HELP);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
