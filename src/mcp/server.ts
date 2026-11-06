// MCP server: stateless Streamable HTTP via the SDK's web-standard transport, which runs on both
// Workers and Node (https://github.com/modelcontextprotocol/typescript-sdk, v1.32, checked 2026-11-06).
// A fresh McpServer is built per request with the caller's identity in the closure.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Principal } from "../core/auth";
import type { Ctx } from "../core/context";
import {
  completeEntry, createEntry, deleteEntry, entryJson, getEntry, getEntryByKey, IMPORTANCES, KINDS, listEntries,
  STATUSES, updateEntry, type EntryRow, type WriteMeta,
} from "../core/entries";
import { CLIENTS, listOrigins, normalizeClient, originInputSchema, upsertOrigin, type OriginInput } from "../core/origins";
import { createProject, findProject, listProjects, projectJson, resolveOrCreateProject } from "../core/projects";
import { rateLimit } from "../core/rateLimit";
import { ApiError, VERSION } from "../core/util";
import { getMoneySummary } from "../core/moneyService";

export const WRITES_PER_MINUTE = 60;

export interface McpCallMeta {
  principal: Principal;
  userAgent: string | null;
}

const ok = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

function fail(e: unknown): CallToolResult {
  if (e instanceof ApiError) {
    const fields = e.extra.fields ? ` ${JSON.stringify(e.extra.fields)}` : "";
    return { isError: true, content: [{ type: "text", text: `${e.code}: ${e.message}${fields}` }] };
  }
  console.error("mcp tool error", e);
  return { isError: true, content: [{ type: "text", text: "internal: something went wrong on the Tickler server" }] };
}

/** Guess the client of a caller that sent no origin, from the OAuth client name or User-Agent. */
export function inferClient(name: string | null, userAgent: string | null): string {
  const s = `${name ?? ""} ${userAgent ?? ""}`.toLowerCase();
  if (s.includes("claude-code") || s.includes("claude code")) return "claude_code";
  if (s.includes("claude")) return "claude_app";
  if (s.includes("chatgpt") || s.includes("openai-mcp")) return "chatgpt";
  if (s.includes("cursor")) return "cursor";
  if (s.includes("codex")) return "codex";
  if (s.includes("gemini")) return "gemini_cli";
  return "other";
}

const ORIGIN_DESC =
  "Where this request comes from, so the user can jump back to it. Always pass it. `client` is one of " +
  CLIENTS.join(", ") +
  ". Include your session/chat/thread id as `session_id` and a link as `open_url` if you have them. " +
  "If a hook already filled in values, keep them unchanged.";

const ref = {
  id: z.string().optional().describe("Entry id (from create_entry or list_entries)"),
  project: z.string().optional().describe("Project name, used with external_key instead of id"),
  external_key: z.string().optional().describe("The stable key the entry was created with, used with project instead of id"),
};

export function buildMcpServer(ctx: Ctx, meta: McpCallMeta): McpServer {
  const { principal } = meta;
  const server = new McpServer(
    { name: "tickler", title: `Tickler (${ctx.config.serverName})`, version: VERSION },
    {
      instructions:
        "Tickler is the user's calendar for things AI agents plan for later. Call create_entry whenever you schedule, defer, " +
        "or hand the user something for a future date (follow-ups, deadlines, launches, renewals, scheduled runs). " +
        "Times are UTC ISO 8601. Use a stable external_key so re-runs update instead of duplicating. " +
        "Always pass origin. Call complete_entry when you finish something that has an entry.",
    },
  );

  const writeMeta = async (origin: OriginInput | undefined, action: string): Promise<WriteMeta> => {
    await rateLimit(ctx, `mcp-write:${principal.actor.type}:${principal.actor.id}`, WRITES_PER_MINUTE, 60);
    let o = origin;
    let flagged = false;
    if (!o || !o.client) {
      flagged = true;
      o = { ...(o ?? {}), client: inferClient(principal.actor.name, meta.userAgent), title: o?.title ?? `Unknown client (${principal.actor.name ?? "token"})` };
    }
    const originId = await upsertOrigin(ctx, o, principal.actor.id);
    return { actor: principal.actor, action, originId, originFlagged: flagged, source: "agent" };
  };

  async function findEntry(a: { id?: string; project?: string; external_key?: string }): Promise<EntryRow> {
    if (a.id) {
      const e = await getEntry(ctx, a.id);
      if (e) return e;
      throw new ApiError(404, "not_found", `No entry with id ${a.id}`);
    }
    if (a.project && a.external_key) {
      const p = await findProject(ctx, a.project);
      const e = p ? await getEntryByKey(ctx, p.id, a.external_key) : null;
      if (e) return e;
      throw new ApiError(404, "not_found", `No entry with external_key "${a.external_key}" in project "${a.project}"`);
    }
    throw new ApiError(400, "bad_request", "Pass id, or project and external_key");
  }

  const entryOut = (e: EntryRow) => ({ entry: entryJson(e), url: `tickler://entry/${e.id}` });

  const fields = {
    title: z.string().max(120).describe("Short title, at most 120 characters, e.g. \"Check App Review status\""),
    start_at: z
      .string()
      .nullable()
      .optional()
      .describe(
        "When it happens or is due, in UTC ISO 8601 (2026-11-20T09:00:00Z). A local time without offset is read in `timezone`; " +
          "a date (2026-11-20) makes it all day. Omit or null only for an undated task. At most 2 years out.",
      ),
    end_at: z.string().nullable().optional().describe("Optional end time, UTC ISO 8601"),
    all_day: z.boolean().optional().describe("All-day entry"),
    timezone: z.string().optional().describe("IANA time zone of the user for display and local times, e.g. Europe/Berlin. Default UTC"),
    kind: z
      .enum(KINDS)
      .optional()
      .describe("task (default), event, deadline, reminder, scheduled_run (a cron/routine you set up), follow_up, launch, renewal"),
    notes: z.string().max(20000).nullable().optional().describe("Markdown notes: context, why it matters, what to check"),
    importance: z.enum(IMPORTANCES).optional().describe("important if missing it costs money, users or a launch window; critical for hard deadlines"),
    recurrence: z.string().nullable().optional().describe("RFC 5545 RRULE without DTSTART, e.g. FREQ=WEEKLY;BYDAY=MO"),
    links: z.array(z.object({ title: z.string(), url: z.string() })).optional().describe("Related links"),
    tags: z.array(z.string()).optional(),
    external_key: z
      .string()
      .optional()
      .describe("Stable idempotency key, unique per project, e.g. \"pr-123-merge-followup\". Re-running with the same key updates instead of duplicating."),
    source_ref: z.string().nullable().optional().describe("Where it was decided: commit hash, PR or issue URL, doc URL"),
  };

  server.registerTool(
    "create_entry",
    {
      title: "Add to the user's Tickler calendar",
      description:
        "Put something on the user's Tickler calendar. Call this whenever you schedule or defer something " +
        "(\"later\", \"tomorrow\", \"after review\"), set up a scheduled task or routine, give the user something to do on a date, " +
        "or learn of a deadline, launch or renewal. Creates the project if it doesn't exist. If an entry with the same " +
        "external_key exists in the project, it is updated instead (created: false). Returns the entry and a tickler:// link.",
      inputSchema: {
        project: z.string().min(1).max(80).describe("Project name, e.g. the repo or product name. Created if new."),
        ...fields,
        origin: originInputSchema.optional().describe(ORIGIN_DESC),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const meta = await writeMeta(a.origin, "create_entry");
        const project = await resolveOrCreateProject(ctx, a.project, principal.actor);
        const { project: _p, origin: _o, ...input } = a;
        const { entry, created } = await createEntry(ctx, project.id, input, meta);
        return ok({ ...entryOut(entry), created, project: projectJson(project) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_entry",
    {
      title: "Change an entry",
      description:
        "Change an existing entry: reschedule it, rename it, add notes or links. Identify it by id, or by project + external_key. " +
        "Only the fields you pass change.",
      inputSchema: { ...ref, ...partial(fields), origin: originInputSchema.optional().describe(ORIGIN_DESC) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (a) => {
      try {
        const cur = await findEntry(a);
        const meta = await writeMeta(a.origin, "update_entry");
        const { id: _i, project: _p, origin: _o, ...patch } = a;
        if (a.id === undefined) delete (patch as { external_key?: string }).external_key;
        return ok(entryOut(await updateEntry(ctx, cur.id, patch, meta)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "complete_entry",
    {
      title: "Mark an entry done",
      description:
        "Call when you finish something that has a Tickler entry. status: done (default), skipped or cancelled; " +
        "planned reopens it. Add a short note on the outcome if useful.",
      inputSchema: {
        ...ref,
        status: z.enum(STATUSES).optional().describe("Default done"),
        note: z.string().max(2000).optional().describe("Outcome, appended to the notes"),
        origin: originInputSchema.optional().describe(ORIGIN_DESC),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (a) => {
      try {
        const cur = await findEntry(a);
        const meta = await writeMeta(a.origin, "complete_entry");
        return ok(entryOut(await completeEntry(ctx, cur.id, { status: a.status ?? "done", note: a.note }, meta)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete an entry",
      description: "Remove an entry that was created by mistake or is no longer relevant (soft delete; the user can still see it was removed). To finish something, use complete_entry instead.",
      inputSchema: { ...ref, origin: originInputSchema.optional().describe(ORIGIN_DESC) },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (a) => {
      try {
        const cur = await findEntry(a);
        const meta = await writeMeta(a.origin, "delete_entry");
        return ok(entryOut(await deleteEntry(ctx, cur.id, meta)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_entries",
    {
      title: "Look up entries",
      description:
        "List entries on the user's Tickler calendar, at most 200. Use it to check before adding something that may already " +
        "exist, or to answer \"what's coming up\". Recurring entries are returned once (not expanded).",
      inputSchema: {
        from: z.string().optional().describe("UTC ISO 8601 start of range"),
        to: z.string().optional().describe("UTC ISO 8601 end of range (exclusive)"),
        project: z.string().optional().describe("Project name"),
        status: z.enum(STATUSES).optional(),
        importance: z.enum(IMPORTANCES).optional(),
        query: z.string().max(200).optional().describe("Text to search in titles and notes, or an exact external_key"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        let projectId: string | null = null;
        if (a.project) {
          const p = await findProject(ctx, a.project);
          if (!p) return ok({ entries: [], note: `No project named "${a.project}"` });
          projectId = p.id;
        }
        const rows = await listEntries(ctx, {
          from: a.from ? new Date(a.from).toISOString() : null,
          to: a.to ? new Date(a.to).toISOString() : null,
          project_id: projectId,
          status: a.status,
          importance: a.importance,
          q: a.query,
          limit: 200,
        });
        return ok({ entries: rows.map(entryJson) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List the user's Tickler projects, so you can file entries under an existing project name.",
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        return ok({ projects: (await listProjects(ctx, !!a.include_archived)).map(projectJson) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: "Create a project. Usually not needed: create_entry creates projects on the fly. Returns the existing project if the name is taken.",
      inputSchema: {
        name: z.string().min(1).max(80),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe("#RRGGBB"),
        icon: z.string().optional().describe("SF Symbol name, e.g. folder, paperplane, server.rack"),
      },
      annotations: { idempotentHint: true },
    },
    async (a) => {
      try {
        await rateLimit(ctx, `mcp-write:${principal.actor.type}:${principal.actor.id}`, WRITES_PER_MINUTE, 60);
        const existing = await findProject(ctx, a.name);
        if (existing) return ok({ project: projectJson(existing), created: false });
        return ok({ project: projectJson(await createProject(ctx, a, principal.actor)), created: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "mark_important",
    {
      title: "Change importance",
      description:
        "Flag an entry as important (missing it costs money, users or a launch window) or critical, or set it back to normal. " +
        "Give a short reason; it is added to the notes.",
      inputSchema: {
        ...ref,
        importance: z.enum(IMPORTANCES),
        reason: z.string().max(500).optional(),
        origin: originInputSchema.optional().describe(ORIGIN_DESC),
      },
      annotations: { idempotentHint: true },
    },
    async (a) => {
      try {
        const cur = await findEntry(a);
        const meta = await writeMeta(a.origin, "mark_important");
        const notes = a.reason ? [cur.notes, `Marked ${a.importance}: ${a.reason}`].filter(Boolean).join("\n\n") : undefined;
        return ok(entryOut(await updateEntry(ctx, cur.id, { importance: a.importance, notes }, meta)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_origins",
    {
      title: "List agent sessions",
      description: "List the chats, sessions and scheduled runs that have written to Tickler, newest first, optionally for one client or project.",
      inputSchema: {
        client: z.enum(CLIENTS).optional(),
        project: z.string().optional().describe("Project name"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        let projectId: string | null = null;
        if (a.project) projectId = (await findProject(ctx, a.project))?.id ?? "\u0000";
        return ok({ origins: await listOrigins(ctx, { client: a.client, project_id: projectId, limit: 200 }) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_money_summary",
    {
      title: "Money summary",
      description:
        "Month-to-date costs, revenue, net and month-end forecast for the user's connected services (App Store, Stripe, " +
        "Anthropic, AWS, Cloudflare...), with budget status and an as-of time for each source. Use it when the user asks about " +
        "spend, revenue or budgets.",
      inputSchema: {
        provider: z.string().optional().describe("Only this provider, e.g. anthropic, aws, app_store"),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default this month"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const summary = await getMoneySummary(ctx, a.month ?? ctx.now().toISOString().slice(0, 7));
        if (a.provider) {
          const s = summary as { providers?: { provider: string }[]; stores?: { store: string }[] };
          return ok({
            ...summary,
            providers: (s.providers ?? []).filter((p) => p.provider === a.provider),
            stores: (s.stores ?? []).filter((p) => p.store === a.provider),
          });
        }
        return ok(summary as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

function partial<T extends Record<string, z.ZodType>>(shape: T) {
  return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.optional()])) as { [K in keyof T]: z.ZodOptional<T[K]> };
}

/** Handle one HTTP request to /mcp (already authenticated). */
export async function handleMcp(ctx: Ctx, req: Request, meta: McpCallMeta): Promise<Response> {
  const server = buildMcpServer(ctx, meta);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON response mode: the response is complete once returned.
    void server.close().catch(() => {});
  }
}
