# Task #5 — Catalog UI + classification badges (SI-T5)

**TRD reference:** FR4 (UI half), FR5 (UI half — override affordance), Usability NFR ("Clear
classification badges and confidence; easy drift review").

**Current state:** NOT STARTED as a catalog UI. Two adjacent pages exist and are candidates for
either extension or replacement:
- `frontend/src/app/dashboard/schema/page.tsx` — a source→target schema comparison/AI-matching
  tool. Not a catalog browser; no search/filter UI.
- `frontend/src/app/dashboard/security/page.tsx` — renders `SecurityService.classify_schema()`
  output for a **hardcoded connection id `1`** (`api.get("/api/v1/schema/1/classify")`, line 22 —
  no connection selector at all) as a flat list. The "🛡️ Run Audit Scan" button (lines 37-39) has
  **no `onClick` handler** — it's decorative, does nothing when clicked.

**[?] Open product question — resolve before implementing:** should the catalog be a new third
page (`/dashboard/catalog`), or should it absorb the Security page's classification list (which is
half of what a catalog needs anyway) or the Schema page's per-connection browsing? Building a third
page that overlaps two existing ones risks the same "which page do I use" confusion a reviewer
would flag. Recommend a quick product/design check before committing to a layout, same caution
`mapper_tasks/01_n_to_one_ui.md` and `Pipelines_tasks/07_pipeline_ui_monitoring.md` flagged for
their own UI decisions.

## Scope (assuming a new `/dashboard/catalog` page — adjust if the product decision above differs)

- Connection selector (fixes the Security page's hardcoded-id-`1` bug as a side effect if that
  page is folded into this one).
- Search/filter bar wired to Task #4's `GET /api/v1/catalog/search` (table/column/type/classification
  filters, debounced free-text).
- Table/column list with: type, nullable indicator (reuse the `*` NOT-NULL convention already
  established in Schema Mapper's `SchemaPanel`, `frontend/.../schema-mapper/components/Canvas.tsx` —
  don't invent a second visual convention for the same concept), classification badge
  (color-coded per `SecurityService`'s existing `color` field: red/amber/green) with confidence
  shown on hover/inline (Task #3), and a drift indicator per table (Task #6) linking to the
  drift-history view.
- Wire the "Run Audit Scan" button (or its equivalent on the new page) to actually call
  Task #1's `POST /api/v1/catalog/scan/{connection_id}` — closing the existing dead-button gap
  regardless of which page it ends up on.

## Dependencies

- Task #1 (catalog data to render).
- Task #4 (search API).
- Task #3 (classification badges + confidence).
- Task #6 (drift indicators) — soft dependency; the page can ship without drift badges and add
  them once #6 lands.

## Verify

- Manual: search/filter round-trip against a seeded connection; classification badges match
  `ColumnClassification` rows; scan button triggers a real scan and the list updates.
- `npm run lint && npm run build` clean in `frontend/`.

## Risk

Medium — the largest single frontend task in this epic, and the one most likely to need product
input mid-build (see the open question above) rather than pure engineering judgment.
