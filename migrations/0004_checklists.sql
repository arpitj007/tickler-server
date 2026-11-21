-- Checklists per project (readiness, launch, marketing, compliance, or the user's own). Their items
-- are entries: checklist_id tags an entry, parent_id makes it a subtask, section groups it.
CREATE TABLE checklists (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  origin_id TEXT,
  scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX checklists_kind ON checklists (project_id, kind) WHERE kind != 'custom' AND deleted_at IS NULL;
CREATE INDEX checklists_rev ON checklists (rev);
ALTER TABLE entries ADD COLUMN checklist_id TEXT;
ALTER TABLE entries ADD COLUMN parent_id TEXT;
ALTER TABLE entries ADD COLUMN section TEXT;
ALTER TABLE entries ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE INDEX entries_checklist ON entries (checklist_id);
