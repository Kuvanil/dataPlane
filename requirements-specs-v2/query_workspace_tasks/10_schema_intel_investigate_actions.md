# Task #10 — "Investigate in Query Workspace" actions on Schema Intel

**Reference:** depends on task #9's `WorkspaceHandoff` contract.

## Part A — PII / classification badges (HIGH confidence)

**File:** `frontend/src/app/dashboard/schema/components/CatalogTableCard.tsx:53-88`.

Each column row already renders a classification badge (`label`/`confidence`/`method`) with an
existing "Override" button. Add a second small action, e.g. "Investigate →", next to it —
visible at least for High-risk/PII labels (the case someone would actually want to dig into),
optional for Public/Low.

- On click, call `writeWorkspaceHandoff({ connectionId, mode: "ask", prefillQuestion:
  \`What does the current data in \${tableName}.\${columnName} look like, and is there anything
  that looks like exposed PII I should be aware of?\`, banner: { sourceModule: "schema_intel",
  summary: \`PII review — \${tableName}.\${columnName} (\${label})\` } })`, then
  `router.push("/dashboard/query-workspace")`.
- `connectionId` here comes from whatever prop already threads the current connection through
  `CatalogTableCard`'s parent (`schema/page.tsx`) — confirm the exact prop name/path at
  implementation time rather than assuming.

## Part B — Drift events (MEDIUM confidence)

**File:** `frontend/src/app/dashboard/schema/components/DriftHistoryPanel.tsx:32-68`.

`DriftEventSummary` names affected tables/columns as plain strings grouped by change type
(`tables_added`, `columns_added: Record<string, string[]>`, `type_changes`, etc.) — there's no
per-row action today. Add an "Investigate →" action per **affected table** (not per individual
column change, to avoid a combinatorial explosion of buttons for a table with many changed
columns):

- For a table appearing in `columns_added`/`columns_removed`/`type_changes`, build:
  `writeWorkspaceHandoff({ connectionId, mode: "sql", sql: \`SELECT * FROM \${tableName} LIMIT
  100;\`, banner: { sourceModule: "schema_intel", summary: \`Drift on \${tableName} — see changed
  columns below\` } })`. Keep the SQL scaffold intentionally simple (`SELECT * ... LIMIT 100`) —
  don't attempt to generate dialect-specific type-introspection SQL (e.g. `pg_typeof`) as part of
  this task; that's speculative complexity for a first cut. The user can refine the query once
  they're in SQL mode looking at real data.
- `connectionId` must come from the `SchemaSnapshotSummary` that owns this `drift_event` (per the
  `DriftEvent` model, `connection_id` lives on the snapshot/event, not on the individual change
  entries) — trace this through `DriftHistoryPanel`'s props back to its parent to find where
  `connection_id` is already available (it must be, since the panel is already scoped to one
  connection's history).
- For a table appearing only in `tables_removed`, there's nothing to query — skip the action for
  that row (querying a dropped table would just error).

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: on a connection with at least one classified High-risk column, click "Investigate →" on
that column, confirm landing in Query Workspace's Ask mode with the question pre-filled and the
right connection selected. Trigger a drift event (rescan after a schema change), click
"Investigate →" on a changed table, confirm landing in SQL mode with `SELECT * FROM <table> LIMIT
100;` pre-filled against the right connection.

## Risk

- Part B's `connectionId`-sourcing is the main open question — confirm the actual prop chain in
  `schema/page.tsx` at implementation time; if `DriftHistoryPanel` genuinely has no connection
  context available (unlikely given it's rendered per-connection, but verify), that's a `[?]` to
  flag rather than guess around.
