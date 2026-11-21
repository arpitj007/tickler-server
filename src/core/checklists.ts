// Checklists: per-project guides whose items are entries (checklist_id, parent_id for subtasks,
// section for grouping). Four built-in kinds come with a starter template; agents fill in the rest
// from the product itself (add_checklist_items), and users add their own custom checklists.
import { z } from "zod";
import { logActivity } from "./activity";
import { BUMP, REV, type Ctx } from "./context";
import { createEntry, deleteEntry, OPEN_STATUSES, updateEntry, getEntryByKey, IMPORTANCES, listEntries, type EntryRow, type WriteMeta } from "./entries";
import { getProject } from "./projects";
import { ApiError, slugify, uuid } from "./util";

export const CHECKLIST_KINDS = ["readiness", "launch", "marketing", "compliance", "custom"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export interface ChecklistRow {
  id: string;
  project_id: string;
  name: string;
  kind: ChecklistKind;
  description: string | null;
  position: number;
  source: string;
  origin_id: string | null;
  scanned_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rev: number;
}

export const checklistJson = (r: ChecklistRow) => ({ ...r });

export const checklistCreateSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().min(1),
  kind: z.enum(CHECKLIST_KINDS).default("custom"),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).nullish(),
  position: z.number().int().min(0).max(1000).optional(),
  /** Add the kind's starter items (built-in kinds only). Default true. */
  template: z.boolean().default(true),
});
export const checklistPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).nullish(),
  position: z.number().int().min(0).max(1000).optional(),
  scanned_at: z.string().max(40).nullish(),
});

interface TemplateItem {
  section: string;
  title: string;
  notes?: string;
  importance?: (typeof IMPORTANCES)[number];
  links?: { title: string; url: string }[];
  subtasks?: string[];
}
interface Template {
  name: string;
  description: string;
  position: number;
  items: TemplateItem[];
}

/** Starter items per built-in kind. Agents add product-specific items on top (see SCAN_GUIDE). */
export const TEMPLATES: Record<Exclude<ChecklistKind, "custom">, Template> = {
  readiness: {
    name: "Product readiness",
    position: 0,
    description:
      "Everything the product needs before real people rely on it. Your AI agent scans the code and adds what's missing; " +
      "when every item is done, the product is ready.",
    items: [
      { section: "Quality", title: "Core flows work end to end", importance: "important", subtasks: ["Onboarding and sign-in", "The main job the product does", "Settings, sign-out and account deletion"] },
      { section: "Quality", title: "Tests pass in CI" },
      { section: "Quality", title: "No known crashes in the latest build" },
      { section: "Security & privacy", title: "No secrets in the repo or the app bundle", importance: "important" },
      { section: "Security & privacy", title: "Auth and data access reviewed" },
      { section: "Security & privacy", title: "People can export and delete their data" },
      { section: "Performance", title: "Fast start and graceful offline or slow network" },
      { section: "Accessibility", title: "Accessible to everyone", subtasks: ["Dynamic Type / font scaling", "Screen reader labels", "Contrast and touch target sizes"] },
      { section: "Operations", title: "Crash reporting and logs in place" },
      { section: "Operations", title: "Backups and restore tested" },
    ],
  },
  launch: {
    name: "Launch",
    position: 1,
    description: "Getting the product into the stores and in front of people on day one.",
    items: [
      {
        section: "Store listing",
        title: "App Store listing ready",
        importance: "important",
        subtasks: ["Name, subtitle and description", "Keywords", "Screenshots for every required size", "Category and age rating", "Support and marketing URLs"],
      },
      { section: "Store listing", title: "Google Play listing ready", subtasks: ["Store listing text and graphics", "Content rating questionnaire", "Data safety form"] },
      { section: "Legal", title: "Privacy policy live at a public URL", importance: "important" },
      { section: "Legal", title: "Terms of use" },
      { section: "Legal", title: "App privacy label filled in" },
      { section: "Pricing", title: "Pricing and in-app purchases set up", subtasks: ["Paid apps agreement, tax and banking", "Products created and approved", "Restore purchases works"] },
      { section: "Beta", title: "Beta round with testers (TestFlight / internal testing)" },
      { section: "Review", title: "Demo account and notes for App Review" },
      { section: "Review", title: "Submit for review", importance: "critical" },
      { section: "Release", title: "Release plan", subtasks: ["Release date", "Phased release or staged rollout", "Hotfix path if something breaks"] },
    ],
  },
  marketing: {
    name: "Marketing",
    position: 2,
    description: "Who it's for, how they hear about it, and what you say.",
    items: [
      { section: "Positioning", title: "One-line pitch", notes: "What it does, for whom, and why it's better than what they use today." },
      { section: "Positioning", title: "Target audience and where they hang out" },
      { section: "Website", title: "Landing page with store badges" },
      { section: "Website", title: "Analytics and attribution" },
      { section: "Content", title: "Launch announcement post" },
      { section: "Content", title: "Demo video" },
      { section: "Content", title: "Press kit", subtasks: ["Icon and logo", "Screenshots", "Short and long description"] },
      { section: "Channels", title: "Product Hunt launch" },
      { section: "Channels", title: "Social posts scheduled" },
      { section: "Channels", title: "Email the waitlist" },
      { section: "Channels", title: "Communities and forums where the audience is" },
      { section: "After launch", title: "Ask happy users for ratings (in-app review prompt)" },
      { section: "After launch", title: "Review launch-week numbers" },
    ],
  },
  compliance: {
    name: "Rules & compliance",
    position: 3,
    description:
      "The business rules, regulations and legal requirements that apply to this product. Your AI agent pulls these in " +
      "from the code and the markets you ship to, with a link to the source for each.",
    items: [
      { section: "Legal", title: "Privacy policy matches what the app actually collects", importance: "important" },
      { section: "Legal", title: "Open-source licenses respected and credited" },
      { section: "Legal", title: "Name and trademark checked" },
      {
        section: "Regulations",
        title: "Privacy law for every market you ship to",
        notes: "For example GDPR (EU/UK), CCPA/CPRA (California), DPDP (India).",
        importance: "important",
        links: [{ title: "GDPR", url: "https://gdpr.eu/" }],
      },
      {
        section: "Regulations",
        title: "Encryption export compliance",
        notes: "Set ITSAppUsesNonExemptEncryption in Info.plist, or answer the export questions in App Store Connect.",
        links: [{ title: "Apple: export compliance", url: "https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations" }],
      },
      { section: "Regulations", title: "Age rating and children's privacy (COPPA) if kids may use it" },
      {
        section: "Regulations",
        title: "Accessibility law (European Accessibility Act, ADA)",
        notes: "The EAA applies to many apps and services sold in the EU since 28 June 2025.",
      },
      {
        section: "Store rules",
        title: "App Store Review Guidelines",
        links: [{ title: "App Review Guidelines", url: "https://developer.apple.com/app-store/review/guidelines/" }],
      },
      {
        section: "Store rules",
        title: "Google Play Developer Program Policies",
        links: [{ title: "Play policies", url: "https://play.google.com/about/developer-content-policy/" }],
      },
      { section: "Store rules", title: "Payments: digital goods use in-app purchase where required" },
      { section: "Business rules", title: "Business rules written down", notes: "Pricing, limits, refunds, data retention and anything else the product must always do or never do. Your agent adds each rule it finds in the code as its own item." },
      { section: "Tax & finance", title: "Tax, invoicing and payouts set up for each store and country" },
    ],
  },
};

/** What an agent should do to build a checklist from the product. Shown in tool descriptions and the apps' prompt. */
export const SCAN_GUIDE =
  "Read the product (code, README, docs, store metadata, issues) and add what's missing for each checklist: " +
  "readiness = features, quality, security, performance, accessibility and operations work left before it's ready; " +
  "launch = store listings, review, pricing, beta and release; marketing = positioning, site, content and channels; " +
  "compliance = the business rules found in the code plus the laws, regulations and store rules that apply, each with a link to its source. " +
  "One item per piece of work, short titles, a section for grouping, subtasks for steps, notes saying what you found and where " +
  "(file paths), status done for things already in place. Re-running updates items by external_key instead of duplicating them.";

export async function getChecklist(ctx: Ctx, id: string) {
  return ctx.storage.first<ChecklistRow>("SELECT * FROM checklists WHERE id = ?", [id]);
}

export async function listChecklists(ctx: Ctx, projectId: string | null) {
  return ctx.storage.all<ChecklistRow>(
    `SELECT * FROM checklists WHERE deleted_at IS NULL ${projectId ? "AND project_id = ?" : ""} ORDER BY project_id, position, created_at`,
    projectId ? [projectId] : [],
  );
}

/** Find a live checklist of a project by id, kind (readiness, launch...) or name. */
export async function findChecklist(ctx: Ctx, projectId: string, ref: string) {
  const r = ref.trim();
  return ctx.storage.first<ChecklistRow>(
    `SELECT * FROM checklists WHERE project_id = ? AND deleted_at IS NULL AND (id = ? OR (kind = ? AND kind != 'custom') OR name = ? COLLATE NOCASE)
     ORDER BY kind = 'custom' LIMIT 1`,
    [projectId, r, r.toLowerCase(), r],
  );
}

export async function createChecklist(
  ctx: Ctx,
  input: z.infer<typeof checklistCreateSchema>,
  meta: WriteMeta,
): Promise<{ checklist: ChecklistRow; created: boolean }> {
  if (!(await getProject(ctx, input.project_id))) throw new ApiError(422, "validation_failed", "Unknown project.", { fields: { project_id: "Unknown project." } });
  if (input.id) {
    const existing = await getChecklist(ctx, input.id);
    if (existing) return { checklist: existing, created: false };
  }
  const tpl = input.kind === "custom" ? null : TEMPLATES[input.kind];
  if (tpl) {
    const existing = await findChecklist(ctx, input.project_id, input.kind);
    if (existing) return { checklist: existing, created: false };
  } else if (!input.name) {
    throw new ApiError(422, "validation_failed", "A custom checklist needs a name.", { fields: { name: "Required." } });
  } else {
    const same = await ctx.storage.first<ChecklistRow>(
      "SELECT * FROM checklists WHERE project_id = ? AND deleted_at IS NULL AND name = ? COLLATE NOCASE",
      [input.project_id, input.name],
    );
    if (same) return { checklist: same, created: false };
  }
  const max = await ctx.storage.first<{ p: number | null }>("SELECT MAX(position) AS p FROM checklists WHERE project_id = ? AND deleted_at IS NULL", [input.project_id]);
  const id = input.id ?? uuid();
  const now = ctx.now().toISOString();
  await ctx.storage.batch([
    BUMP,
    {
      sql: `INSERT INTO checklists (id, project_id, name, kind, description, position, source, origin_id, scanned_at, created_at, updated_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ${REV})`,
      params: [
        id, input.project_id, input.name ?? tpl!.name, input.kind, input.description ?? tpl?.description ?? null,
        input.position ?? tpl?.position ?? Math.max(4, (max?.p ?? -1) + 1), meta.source ?? "manual", meta.originId ?? null, now, now,
      ],
    },
  ]);
  const checklist = (await getChecklist(ctx, id))!;
  await logActivity(ctx, meta.actor, meta.action, `Checklist "${checklist.name}"`, meta.originId ?? null);
  if (tpl && input.template) {
    await addItems(ctx, checklist, tpl.items.map((i) => ({ ...i, subtasks: i.subtasks?.map((t) => ({ title: t })) })), {
      ...meta,
      source: "system",
      action: `${meta.action} (template)`,
    });
  }
  return { checklist, created: true };
}

export async function updateChecklist(ctx: Ctx, id: string, patch: z.infer<typeof checklistPatchSchema>, meta: WriteMeta) {
  const cur = await getChecklist(ctx, id);
  if (!cur || cur.deleted_at) throw new ApiError(404, "not_found", "Checklist not found");
  const scanned = patch.scanned_at === undefined ? cur.scanned_at : patch.scanned_at ? new Date(patch.scanned_at).toISOString() : null;
  await ctx.storage.batch([
    BUMP,
    {
      sql: `UPDATE checklists SET name = ?, description = ?, position = ?, scanned_at = ?, updated_at = ?, rev = ${REV} WHERE id = ?`,
      params: [
        patch.name ?? cur.name, patch.description === undefined ? cur.description : patch.description ?? null, patch.position ?? cur.position,
        scanned, ctx.now().toISOString(), id,
      ],
    },
  ]);
  await logActivity(ctx, meta.actor, meta.action, `Checklist "${patch.name ?? cur.name}": ${Object.keys(patch).join(", ")}`, meta.originId ?? null);
  return (await getChecklist(ctx, id))!;
}

/** Soft delete the checklist and its items. */
export async function deleteChecklist(ctx: Ctx, id: string, meta: WriteMeta) {
  const cur = await getChecklist(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Checklist not found");
  if (cur.deleted_at) return cur;
  const items = await ctx.storage.all<{ id: string }>("SELECT id FROM entries WHERE checklist_id = ? AND parent_id IS NULL AND deleted_at IS NULL", [id]);
  for (const i of items) await deleteEntry(ctx, i.id, meta);
  const now = ctx.now().toISOString();
  await ctx.storage.batch([BUMP, { sql: `UPDATE checklists SET deleted_at = ?, updated_at = ?, rev = ${REV} WHERE id = ?`, params: [now, now, id] }]);
  await logActivity(ctx, meta.actor, meta.action, `Deleted checklist "${cur.name}"`, meta.originId ?? null);
  return (await getChecklist(ctx, id))!;
}

const linkSchema = z.object({ title: z.string().trim().max(200), url: z.string().trim().url().max(2000) });
const itemBase = {
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(20_000).nullish(),
  external_key: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["planned", "in_progress", "done", "skipped", "cancelled"]).optional(),
  importance: z.enum(IMPORTANCES).optional(),
  links: z.array(linkSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  source_ref: z.string().trim().max(2000).nullish(),
};
export const checklistItemSchema = z.object({
  ...itemBase,
  section: z.string().trim().max(60).nullish(),
  subtasks: z.array(z.object(itemBase)).max(30).optional(),
});
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;

const keyPart = (s: string) => slugify(s).slice(0, 60) || "item";

/**
 * Add items (and their subtasks) to a checklist. Each item is an undated task entry keyed by
 * external_key (derived from checklist, section and title when not given), so a re-scan updates
 * items instead of duplicating them. Starter items use the same keys, so an agent adding the same title
 * in the same section updates the starter item. On an existing item a status only closes it (a scan
 * found it already done); re-runs never reopen anything.
 */
export async function addItems(ctx: Ctx, checklist: ChecklistRow, items: ChecklistItemInput[], meta: WriteMeta) {
  const out: { entry: EntryRow; created: boolean; subtasks: { entry: EntryRow; created: boolean }[] }[] = [];
  const base = await ctx.storage.first<{ p: number | null }>("SELECT MAX(position) AS p FROM entries WHERE checklist_id = ? AND parent_id IS NULL", [checklist.id]);
  let pos = (base?.p ?? -1) + 1;
  for (const it of items) {
    const key = it.external_key ?? `cl:${checklist.kind === "custom" ? checklist.id.slice(0, 8) : checklist.kind}:${keyPart(it.section ?? "")}:${keyPart(it.title)}`;
    const existing = await getEntryByKey(ctx, checklist.project_id, key);
    const { subtasks, section, ...fields } = it;
    const r = await createEntry(
      ctx,
      checklist.project_id,
      {
        ...stripUndef(fields),
        title: it.title,
        kind: "task",
        external_key: key,
        checklist_id: checklist.id,
        section: section ?? null,
        ...(existing ? {} : { position: pos++ }),
      },
      meta,
    );
    if (existing) r.entry = await closeIfAsked(ctx, r.entry, it.status, meta);
    const subs: { entry: EntryRow; created: boolean }[] = [];
    let sp = 0;
    for (const st of subtasks ?? []) {
      const skey = st.external_key ?? `${key}:${keyPart(st.title)}`;
      const sex = await getEntryByKey(ctx, checklist.project_id, skey);
      const sr = await createEntry(
        ctx,
        checklist.project_id,
        { ...stripUndef(st), title: st.title, kind: "task", external_key: skey, checklist_id: checklist.id, parent_id: r.entry.id, section: section ?? null, ...(sex ? {} : { position: sp }) },
        meta,
      );
      if (sex) sr.entry = await closeIfAsked(ctx, sr.entry, st.status, meta);
      subs.push(sr);
      sp++;
    }
    out.push({ entry: r.entry, created: r.created, subtasks: subs });
  }
  return out;
}

async function closeIfAsked(ctx: Ctx, e: EntryRow, status: string | undefined, meta: WriteMeta) {
  if (!status || OPEN_STATUSES.includes(status) || !OPEN_STATUSES.includes(e.status)) return e;
  return updateEntry(ctx, e.id, { status: status as EntryRow["status"] }, meta);
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Progress over leaf items (items without subtasks, and subtasks). Cancelled items don't count. */
export function progress(entries: EntryRow[]) {
  const live = entries.filter((e) => !e.deleted_at);
  const parents = new Set(live.filter((e) => e.parent_id).map((e) => e.parent_id));
  const leaves = live.filter((e) => !parents.has(e.id) && e.status !== "cancelled");
  const done = leaves.filter((e) => e.status === "done" || e.status === "skipped").length;
  return { done, total: leaves.length, complete: leaves.length > 0 && done === leaves.length };
}

/** A checklist with its items nested (subtasks under their item), for MCP and agents. */
export async function checklistDetail(ctx: Ctx, c: ChecklistRow) {
  const rows = await listEntries(ctx, { checklist_id: c.id, limit: 1000 });
  const brief = (e: EntryRow) => ({
    id: e.id, title: e.title, status: e.status, importance: e.importance, section: e.section, external_key: e.external_key,
    notes: e.notes, start_at: e.start_at,
  });
  const top = rows.filter((e) => !e.parent_id).sort((a, b) => a.position - b.position);
  return {
    ...checklistJson(c),
    progress: progress(rows),
    items: top.map((e) => ({
      ...brief(e),
      subtasks: rows.filter((s) => s.parent_id === e.id).sort((a, b) => a.position - b.position).map(brief),
    })),
  };
}
