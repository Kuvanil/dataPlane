# Task #1 — Many-to-one (N:1) mapping creation is unreachable in the Canvas UI

**TRD reference:** FR3 ("The system shall support one-to-one and many-to-one... mappings"),
FR2/AC1 (visual mapping creation), acceptance checklist item "One-to-one and many-to-one
mappings supported."

**Gap:** `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`'s `onDrop` handler
(lines 151-171) always builds a single-element `sources` array:

```ts
await onCreateEdge(
  { table: target.table, column: target.column, type: target.type, primary_key: target.primary_key },
  [{ table: source.table, column: source.column, type: source.type }],
);
```

There is no UI state or gesture for accumulating more than one source column before creating
the edge. The backend fully supports N:1 (`FieldMapping.sources` is a JSON list; the `concat`
transformation kind explicitly exists to combine multiple sources — see
`backend/app/services/transformation_grammar.py:156-174` and
`test_export_handles_multi_source_edge` in `backend/tests/mapping/test_export_contract.py`), but
a user cannot actually build the "concat first_name + last_name" example the transformation
grammar and `docs/mapper-mapping-contract.md` use, by clicking around the workspace.

**Related backend gap found while scoping this:** nothing today stops a single-source-only
transformation kind from being saved against a multi-source edge. Every `_sql_*` function in
`transformation_grammar.py` except `_sql_concat` only ever consumes exactly one source position
(`_sql_direct`, `_sql_cast`, `_sql_upper`, `_sql_lower`, `_sql_trim`, `_sql_coalesce`,
`_sql_default`, `_sql_null_if`, `_sql_lookup` all emit a single `%s` for "the" source). If a
2-source edge is saved with `{"kind": "direct"}` (which `parse()` currently allows — it never
checks `len(sources)` against the kind), the compiled SQL fragment silently has one placeholder
against N bound values, which will surface as a parameter-count mismatch (or worse, silent
data corruption depending on the driver) only when Pipelines eventually executes it — not at
mapping-creation or validation time, where it should be caught.

## Changes

### 1. `backend/app/services/transformation_grammar.py`
- Add a `MULTI_SOURCE_KINDS = frozenset({"concat"})` constant.
- In `parse()`, this function doesn't have access to the edge's `sources` count (it only
  validates the transformation payload shape) — so the check belongs one layer up, in the
  service, where both `sources` and `transformation` are available together.

### 2. `backend/app/services/mapping_service.py`
- In `add_edge`, `update_edge_transformation`, and `_add_edge_internal`, after the existing
  `parse()` call, add: if `len(sources) > 1` and `transformation.get("kind") not in
  MULTI_SOURCE_KINDS`, raise `HTTPException(422, detail={"kind": "grammar_error", "message":
  f"transformation kind '{kind}' does not support {len(sources)} source columns; only 'concat' does"})`.
  (Import `MULTI_SOURCE_KINDS` from `transformation_grammar`.)
- Note: `update_edge_transformation` doesn't currently have access to the edge's `sources` count
  either — it does (`edge.sources` is loaded from the fetched `FieldMapping` row before the
  `parse()` call), so this is a straightforward addition, not a new query.

### 3. `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- Add a "staging" selection mode: clicking a source column (instead of only dragging) toggles it
  into a `selectedSourceIds: string[]` state, rendered with a distinct highlight (e.g. a colored
  left border + checkmark) so the user can see which sources are queued.
- Add a small "Connect N → target" affordance once ≥1 source is selected — e.g. a floating pill
  near the connector column reading "2 sources selected — click a target column to connect," so
  the existing single-drag gesture keeps working unchanged for the common 1:1 case, and the new
  multi-select-then-click flow is additive, not a replacement.
- When ≥2 sources are staged and the user clicks a target column: call `onCreateEdge` with all
  staged sources, and default the transformation to `{ kind: "concat", parts: sources.map(() =>
  ({ kind: "source" })) }` instead of `{ kind: "direct" }` (page.tsx's `onCreateEdge` closure,
  line ~164-170, currently hardcodes `direct` for every drop — this needs to become
  source-count-aware) — since `direct` would now be rejected server-side by change #2 above.
- Clear `selectedSourceIds` after a successful connect (mirroring the existing
  `setDraggingSourceId(null)` cleanup in `onDrop`).

### 4. `frontend/src/app/dashboard/schema-mapper/page.tsx`
- Update the `onCreateEdge` prop passed to `Canvas` (lines 164-170) to accept the transformation
  from the caller instead of hardcoding `{ kind: "direct" }`, since Canvas now needs to pass
  `concat` for multi-source drops.

### 5. Tests
- `backend/tests/mapping/test_mapping_service.py`: `test_add_edge_rejects_multi_source_direct`
  — 2 sources + `{"kind": "direct"}` → 422. `test_add_edge_allows_multi_source_concat` — 2
  sources + `{"kind": "concat", ...}` → 201 (this path is already exercised indirectly by the
  existing `test_export_handles_multi_source_edge`, but that test goes through
  `MappingService.add_edge` directly with `concat` already, so it won't catch a regression in
  the new guard — add an explicit negative case).
- No good way to test the Canvas drag/click interaction in the current test suite (no frontend
  component test harness exists for this module) — verify manually via `npm run dev` +
  `docker compose up`: create a mapping, select two source columns, click a target, confirm a
  `concat` edge is created with both sources in `sources[]`.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v   # must stay 100/100 or grow
cd frontend && npx tsc --noEmit && npm run build
```

## Risk

- The backend guard (change #2) is a **breaking change** for any existing draft edge that
  somehow has >1 source with a non-`concat` kind — none should exist today since the UI never
  produced one, but if a direct API caller created one, `update_edge_transformation` on it (even
  to a still-invalid payload) would now 422 where it previously didn't. Acceptable: such an edge
  was already broken and would have failed at Pipelines-execution time; this just surfaces the
  failure earlier, which is the point.
- The Canvas UX addition is purely additive (new click-select path); the existing single-source
  drag-and-drop flow must continue to work unchanged — verify FR2/AC1's existing 1:1 flow still
  passes manual QA after this change.
