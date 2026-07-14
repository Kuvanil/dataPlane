# Task #11 — "Investigate in Query Workspace" actions on Schema Mapper

**Reference:** depends on task #9's `WorkspaceHandoff` contract.

## Part A — AI suggestions (HIGH confidence)

**File:** `frontend/src/app/dashboard/schema-mapper/components/SuggestionPanel.tsx:56-103`.

Each pending `AISuggestion` row already carries `source_table`/`source_column`/`target_table`/
`target_column`/`confidence`/`reason` directly (`backend/app/models/mapping.py:142-168`) — no
lookup needed. Add an "Investigate →" action next to Accept/Reject, at least for low-confidence
suggestions where the reviewer would plausibly want to look at real data before deciding:

- `writeWorkspaceHandoff({ connectionId, mode: "sql", sql: \`SELECT \${source_column}, COUNT(*)
  FROM \${source_table} GROUP BY \${source_column} ORDER BY COUNT(*) DESC LIMIT 50;\`, banner: {
  sourceModule: "schema_mapper", summary: \`Reviewing suggestion — \${source_table}.
  \${source_column} → \${target_table}.\${target_column} (\${confidence}% confidence)\` } })`.
- `connectionId` is the mapping's source (or target) connection — confirm which one
  `SuggestionPanel`'s parent (`page.tsx`/`useMapping.ts`) already has in scope; a mapping has both
  a source and target connection, so be explicit about which one the scaffold query should run
  against (source, since the scaffold inspects `source_table`/`source_column`).

## Part B — Validation issues (MEDIUM-LOW confidence — the real work in this task)

**File:** `frontend/src/app/dashboard/schema-mapper/components/ValidationPanel.tsx:11-85`.

`ValidationIssue` (`lib/types.ts:118-133`) only carries `edge_id`/`suggestion_id`/`verdict`/
`message` — not resolved table/column names. The existing "Jump to edge #N →" button
(lines 68-76) already proves an `edge_id` can be resolved to a real edge via `onJumpToEdge`,
which must have access to the mapping's `edges` array somewhere up the component tree (likely
`page.tsx` or `Canvas.tsx`, per `useMapping.ts`'s state shape from the schema-mapper epic).

- Add a second action next to "Jump to edge #N →": "Investigate →", which needs its own resolver
  — a callback (passed down alongside `onJumpToEdge`) that looks up the edge by `edge_id` in the
  mapping's edges array and returns its source/target table/column, then builds:
  `writeWorkspaceHandoff({ connectionId, mode: "sql", sql: \`SELECT \${sourceColumn} FROM
  \${sourceTable} WHERE \${sourceColumn} IS NOT NULL LIMIT 100;\`, banner: { sourceModule:
  "schema_mapper", summary: \`Validation issue on edge #\${edgeId} — \${message}\` } })`. The
  exact scaffold query is a starting point, not a precise fix suggestion — the point is to get the
  user looking at real source data quickly, not to solve the validation issue automatically.
- If `suggestion_id` is set instead of (or alongside) `edge_id`, prefer resolving via the
  suggestion (Part A's data is already fully resolved, no lookup needed) rather than the edge.
- Don't add this action for issues with neither `edge_id` nor `suggestion_id` resolvable — that
  is, don't guess a target if no reliable ref exists.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: with a mapping that has at least one pending AI suggestion, click "Investigate →" on it,
confirm landing in SQL mode with a scaffold query against the correct source connection/table. With
a mapping that has a validation issue on a real edge, click its "Investigate →", confirm the
resolved source table/column produce a sensible scaffold query.

## Risk

- Part B is genuinely harder than Part A — it requires threading an edge-resolver callback down to
  `ValidationPanel` (or moving the button's logic up to wherever `edges` is already in scope,
  mirroring how `onJumpToEdge` presumably already works). Read `page.tsx`/`Canvas.tsx`/
  `useMapping.ts` in `schema-mapper/` before starting to confirm exactly how `onJumpToEdge`
  resolves an edge today, and follow that same pattern rather than inventing a second lookup path.
- If a mapping's source and target connections differ and it's ambiguous which one a validation
  issue's scaffold query should target, default to the source connection (where the raw data being
  mapped actually lives) and note the choice in the progress log rather than silently picking one.
