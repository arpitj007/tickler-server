import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../src/core/checklists";
import { makeApp, setupAll, tool } from "./helpers";

const origin = { client: "claude_code", session_id: "sess-cl" };

describe("checklists over MCP", () => {
  it("add_checklist_items creates the built-in checklist with starter items, then is idempotent", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const items = [
      { section: "Core features", title: "Sync works offline", notes: "ios/Shared/Sync.swift", subtasks: [{ title: "Queue edits" }, { title: "Replay on reconnect" }] },
      { section: "Quality", title: "Tests pass in CI", status: "done" }, // same as a starter item: updates it
    ];
    const a = await tool(t, s.mcp, "add_checklist_items", { project: "Shop", checklist: "readiness", items, scanned: true, origin });
    expect(a.isError).toBe(false);
    expect(a.data.checklist.kind).toBe("readiness");
    expect(a.data.checklist.scanned_at).not.toBeNull();
    expect(a.data.created).toBe(3); // the new item + 2 subtasks
    expect(a.data.updated).toBe(1);
    const leaves = TEMPLATES.readiness.items.reduce((n, i) => n + (i.subtasks?.length || 1), 0);
    expect(a.data.checklist.progress).toEqual({ done: 1, total: leaves + 2, complete: false }); // the parent's 2 subtasks are leaves
    const b = await tool(t, s.mcp, "add_checklist_items", { project: "Shop", checklist: "readiness", items, origin });
    expect(b.data.created).toBe(0);
    const list = await tool(t, s.mcp, "list_checklists", { project: "Shop" });
    expect(list.data.checklists).toHaveLength(1);
    const sync = list.data.checklists[0].items.find((i: { title: string }) => i.title === "Sync works offline");
    expect(sync.subtasks.map((x: { title: string }) => x.title)).toEqual(["Queue edits", "Replay on reconnect"]);
    expect(sync.section).toBe("Core features");
  });

  it("completing subtasks finishes the item; reopening one reopens it; finishing the item closes its subtasks", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await tool(t, s.mcp, "create_checklist", { project: "Shop", kind: "custom", name: "Beta", origin });
    const r = await tool(t, s.mcp, "add_checklist_items", {
      project: "Shop", checklist: "Beta", origin,
      items: [{ title: "Invite testers", external_key: "invite", subtasks: [{ title: "Friends", external_key: "f" }, { title: "Users", external_key: "u" }] }],
    });
    expect(r.isError).toBe(false);
    await tool(t, s.mcp, "complete_entry", { project: "Shop", external_key: "f", origin });
    let parent = (await tool(t, s.mcp, "list_entries", { project: "Shop", query: "invite" })).data.entries[0];
    expect(parent.status).toBe("planned");
    await tool(t, s.mcp, "complete_entry", { project: "Shop", external_key: "u", origin });
    parent = (await tool(t, s.mcp, "list_entries", { project: "Shop", query: "invite" })).data.entries[0];
    expect(parent.status).toBe("done");
    await tool(t, s.mcp, "complete_entry", { project: "Shop", external_key: "u", status: "planned", origin });
    parent = (await tool(t, s.mcp, "list_entries", { project: "Shop", query: "invite" })).data.entries[0];
    expect(parent.status).toBe("in_progress");
    await tool(t, s.mcp, "complete_entry", { project: "Shop", external_key: "invite", origin });
    const u = (await tool(t, s.mcp, "list_entries", { project: "Shop", query: "u" })).data.entries.find((e: { external_key: string }) => e.external_key === "u");
    expect(u.status).toBe("done");
  });

  it("create_entry with checklist tags the entry; a wrong checklist is an error", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const e = await tool(t, s.mcp, "create_entry", { project: "Shop", title: "Record demo video", checklist: "marketing", section: "Content", origin });
    expect(e.isError).toBe(false);
    expect(e.data.entry.checklist_id).toBeTruthy();
    expect(e.data.entry.section).toBe("Content");
    const sub = await tool(t, s.mcp, "create_entry", { project: "Shop", title: "Script", parent: e.data.entry.id, origin });
    expect(sub.data.entry.parent_id).toBe(e.data.entry.id);
    expect(sub.data.entry.checklist_id).toBe(e.data.entry.checklist_id);
    const bad = await tool(t, s.mcp, "create_entry", { project: "Shop", title: "x", checklist: "Nope", origin });
    expect(bad.isError).toBe(true);
    const nested = await tool(t, s.mcp, "create_entry", { project: "Shop", title: "y", parent: sub.data.entry.id, origin });
    expect(nested.isError).toBe(true);
    expect(nested.text).toContain("one level");
  });
});

describe("checklists over REST", () => {
  it("create, sync, rename, delete with items", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const p = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Shop" } })).json();
    const tpl = await (await t.req("/api/checklist-templates", { token: s.device })).json();
    expect(tpl.templates.map((x: { kind: string }) => x.kind)).toEqual(["readiness", "launch", "marketing", "compliance"]);
    expect(tpl.scan_guide).toContain("compliance");
    const c = await t.req("/api/checklists", { method: "POST", token: s.device, json: { project_id: p.id, kind: "launch" } });
    expect(c.status).toBe(201);
    const cl = await c.json();
    const again = await t.req("/api/checklists", { method: "POST", token: s.device, json: { project_id: p.id, kind: "launch" } });
    expect(again.status).toBe(200);
    const custom = await t.req("/api/checklists", { method: "POST", token: s.device, json: { project_id: p.id, kind: "custom" } });
    expect(custom.status).toBe(422);
    const ch = await (await t.req("/api/changes?since=0", { token: s.device })).json();
    expect(ch.checklists).toHaveLength(1);
    expect(ch.entries.every((e: { checklist_id: string }) => e.checklist_id === cl.id)).toBe(true);
    const detail = await (await t.req(`/api/checklists/${cl.id}`, { token: s.device })).json();
    expect(detail.progress.done).toBe(0);
    const item = await t.req("/api/entries", { method: "POST", token: s.device, json: { project_id: p.id, title: "Mine", checklist_id: cl.id, section: "Beta" } });
    expect(item.status).toBe(201);
    const renamed = await (await t.req(`/api/checklists/${cl.id}`, { method: "PATCH", token: s.device, json: { name: "Go live" } })).json();
    expect(renamed.name).toBe("Go live");
    await t.req(`/api/checklists/${cl.id}`, { method: "DELETE", token: s.device });
    const live = await (await t.req(`/api/entries?checklist_id=${cl.id}`, { token: s.device })).json();
    expect(live.entries).toHaveLength(0);
    // the kind is free again
    expect((await t.req("/api/checklists", { method: "POST", token: s.device, json: { project_id: p.id, kind: "launch", template: false } })).status).toBe(201);
  });

  it("moving an item to another project drops its checklist", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const a = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "A" } })).json();
    const b = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "B" } })).json();
    const cl = await (await t.req("/api/checklists", { method: "POST", token: s.device, json: { project_id: a.id, kind: "custom", name: "X" } })).json();
    const e = await (await t.req("/api/entries", { method: "POST", token: s.device, json: { project_id: a.id, title: "t", checklist_id: cl.id } })).json();
    const moved = await (await t.req(`/api/entries/${e.id}`, { method: "PATCH", token: s.device, json: { project_id: b.id } })).json();
    expect(moved.checklist_id).toBeNull();
    const wrong = await t.req(`/api/entries/${e.id}`, { method: "PATCH", token: s.device, json: { checklist_id: cl.id } });
    expect(wrong.status).toBe(422);
  });
});
