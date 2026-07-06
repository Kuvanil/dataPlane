# Task #4 — Catalog search API (SI-T4 search half)

**TRD reference:** FR4, Performance NFR ("UI catalog search ≤ 1s").

**Current state:** NOT STARTED. Grep for `catalog` and `/search` across `backend/app` and
`frontend/src` returns zero results anywhere. `frontend/src/app/dashboard/schema/page.tsx` (731
lines, fully read) is a source→target schema *comparison* UI (dropdown connection pickers + AI
table-match results) — no search box, no filter-by-table/column/type/classification control.
`frontend/src/app/dashboard/security/page.tsx` renders one flat unfiltered list for a hardcoded
connection id (`1`). Neither page, nor any backend router, has a search/filter concept today.

## Scope

### Router — extend `backend/app/api/routers/schema_catalog.py` (Task #1)

`GET /api/v1/catalog/search` with query params: `q` (free-text match against table/column name),
`connection_id` (optional filter), `data_type` (optional), `classification_label` (optional, e.g.
`PII`), `page`/`limit` (paginated — mirror the existing `Paginated[T]` envelope shape already used
by `GET /api/v1/mappings/` and `GET /api/v1/audit/`, don't invent a new pagination convention).

### Service — extend `backend/app/services/schema_catalog_service.py` (Task #1)

`search_catalog(db, *, q, connection_id, data_type, classification_label, limit, offset)` — a
straightforward filtered SQL query joining `CatalogColumn` → `CatalogTable` and, once Task #3 has
persisted rows, `ColumnClassification`. Add a DB index on `CatalogColumn.column_name` and
`CatalogTable.table_name` for the free-text path (`ILIKE`/`LIKE` on an indexed column is sufficient
at the TRD's stated scale — no need for a dedicated search engine here).

## Dependencies

- Task #1 (catalog tables to query).
- Task #3 (`classification_label` filter only degrades gracefully — returns unfiltered-by-classification
  results — until #3's `ColumnClassification` rows exist; don't block this task's other filters on #3).

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/test_search.py -v
```
- Confirm search returns in well under 1s against a seeded catalog of realistic size (TRD's own
  benchmark table: 100-column table, extrapolate to a few thousand catalog rows for a search
  index sanity check — this is a much easier bar than the AC1000-column canvas-virtualization
  concern in `mapper_tasks/04_canvas_virtualization.md`, since this is server-side paginated SQL,
  not client-rendered rows).

## Risk

Low. Standard filtered-list endpoint work with direct precedent already in this codebase
(`GET /api/v1/mappings/`, `GET /api/v1/audit/`).
