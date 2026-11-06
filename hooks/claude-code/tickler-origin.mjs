#!/usr/bin/env node
// Tickler origin hook for Claude Code (PreToolUse, matcher "mcp__tickler__.*").
// Fills in `origin` on Tickler write tools so every entry links back to this session:
// client, session id, cwd, git remote and branch, hostname, transcript path, a resume command,
// and the first prompt as the title. Values the model already passed are kept.
// No dependencies. It never blocks a tool call: on any problem it exits 0 with no output.
//
// Output format: hookSpecificOutput.updatedInput replaces the whole tool input
// (https://code.claude.com/docs/en/hooks, "PreToolUse decision control", checked 2026-11-06).
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { hostname } from "node:os";

const WRITE_TOOLS = new Set(["create_entry", "update_entry", "complete_entry", "delete_entry", "mark_important"]);

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** "git@github.com:me/repo.git" or "https://user@github.com/me/repo.git" -> "github.com/me/repo" */
export function normalizeRemote(url) {
  if (!url) return null;
  let s = url.trim().replace(/\.git$/, "");
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(s);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(s);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return s;
  }
}

export function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** First user prompt in the transcript (reads at most 256 KB), trimmed to 80 characters. */
function firstPrompt(path) {
  if (!path) return null;
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "user" || row.isMeta) continue;
      const c = row.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.find((p) => p.type === "text")?.text : null;
      if (text && !text.startsWith("<")) return text.replace(/\s+/g, " ").trim().slice(0, 80);
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

export function buildOrigin(input, env = process.env) {
  const cwd = input.cwd || process.cwd();
  const remote = env.CLAUDE_CODE_REMOTE === "true";
  const sid = input.session_id || null;
  const sub = input.agent_id ? `${sid}/${input.agent_id}` : null;
  const webId = env.CLAUDE_CODE_REMOTE_SESSION_ID || null;
  const origin = {
    client: remote ? "claude_code_web" : "claude_code",
    session_id: sub ?? sid,
    parent_session_id: sub ? sid : null,
    title: sub ? `Subagent: ${input.agent_type || "agent"}` : firstPrompt(input.transcript_path),
    open_url: env.TICKLER_OPEN_URL || (remote && webId ? `https://claude.ai/code/${webId}` : null),
    resume_command: sid && !remote ? `cd ${shellQuote(cwd)} && claude --resume ${sid}` : null,
    machine: remote ? null : hostname(),
    cwd,
    repo: normalizeRemote(git(cwd, ["remote", "get-url", "origin"])),
    branch: git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]) ?? git(cwd, ["rev-parse", "--short", "HEAD"]),
    transcript_path: input.transcript_path || null,
  };
  return Object.fromEntries(Object.entries(origin).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

/** Returns the hook output object, or null to leave the call untouched. */
export function run(input, env = process.env) {
  const tool = String(input.tool_name || "").split("__").pop();
  if (!WRITE_TOOLS.has(tool)) return null;
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const given = toolInput.origin && typeof toolInput.origin === "object" ? toolInput.origin : {};
  const kept = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, origin: { ...buildOrigin(input, env), ...kept } },
    },
  };
  if (env.TICKLER_HOOK_ALLOW === "1") out.hookSpecificOutput.permissionDecision = "allow";
  return out;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const out = run(JSON.parse(raw));
  if (out) process.stdout.write(JSON.stringify(out));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("tickler-origin.mjs")) {
  main().catch(() => process.exit(0));
}
