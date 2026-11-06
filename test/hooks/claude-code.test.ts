import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(__dirname, "../../hooks/claude-code/tickler-origin.mjs");

function runHook(input: unknown, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  expect(r.status).toBe(0);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "tickler hook "));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "feature/x");
  git("remote", "add", "origin", "git@github.com:me/demo.git");
  const transcript = join(dir, "t.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { role: "user", content: "Remind me to check the deploy tomorrow at 9" } }),
    ].join("\n"),
  );
  return { dir, transcript };
}

describe("Claude Code origin hook", () => {
  it("fills origin for write tools with git info and a resume command", () => {
    const { dir, transcript } = repo();
    const out = runHook({
      session_id: "sess-42",
      transcript_path: transcript,
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__tickler__create_entry",
      tool_input: { project: "Demo", title: "Check deploy", start_at: "2026-11-07T09:00:00Z" },
    });
    const h = out.hookSpecificOutput;
    expect(h.hookEventName).toBe("PreToolUse");
    expect(h.permissionDecision).toBeUndefined();
    expect(h.updatedInput.title).toBe("Check deploy");
    expect(h.updatedInput.start_at).toBe("2026-11-07T09:00:00Z");
    const o = h.updatedInput.origin;
    expect(o.client).toBe("claude_code");
    expect(o.session_id).toBe("sess-42");
    expect(o.repo).toBe("github.com/me/demo");
    expect(o.branch).toBe("feature/x");
    expect(o.cwd).toBe(dir);
    expect(o.resume_command).toBe(`cd '${dir}' && claude --resume sess-42`); // path has a space, so quoted
    expect(o.title).toBe("Remind me to check the deploy tomorrow at 9");
    expect(o.machine).toBeTruthy();
  });

  it("keeps values already present and marks subagents", () => {
    const { dir } = repo();
    const out = runHook({
      session_id: "s1",
      agent_id: "a7",
      agent_type: "Explore",
      cwd: dir,
      tool_name: "mcp__tickler__update_entry",
      tool_input: { id: "x", origin: { client: "claude_code", title: "My title", open_url: "https://x" } },
    });
    const o = out.hookSpecificOutput.updatedInput.origin;
    expect(o.title).toBe("My title");
    expect(o.open_url).toBe("https://x");
    expect(o.session_id).toBe("s1/a7");
    expect(o.parent_session_id).toBe("s1");
  });

  it("web sessions: claude_code_web and open_url, no resume command", () => {
    const { dir } = repo();
    const out = runHook(
      { session_id: "s1", cwd: dir, tool_name: "mcp__tickler__create_entry", tool_input: {} },
      { CLAUDE_CODE_REMOTE: "true", CLAUDE_CODE_REMOTE_SESSION_ID: "web123", TICKLER_HOOK_ALLOW: "1" },
    );
    const h = out.hookSpecificOutput;
    expect(h.permissionDecision).toBe("allow");
    expect(h.updatedInput.origin.client).toBe("claude_code_web");
    expect(h.updatedInput.origin.open_url).toBe("https://claude.ai/code/web123");
    expect(h.updatedInput.origin.resume_command).toBeUndefined();
  });

  it("leaves read tools alone and never fails on bad input", () => {
    expect(runHook({ tool_name: "mcp__tickler__list_entries", tool_input: {} })).toBeNull();
    const r = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
