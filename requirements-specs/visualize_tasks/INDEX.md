# Visualize (frontend_tasks #1 / TRD_DataPlane_Visualize) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Visualize.md` (FR1–FR8),
> `requirements-specs/frontend_tasks/01_visualize_charting.md` (Task #1 UI breakdown).
> Scope: backend `/api/v1/viz/*` aggregation + saved-view API, new charting page at
> `/dashboard/visualize`, topology graph relocated to `/dashboard/visualize/topology`.

## FR coverage (landed 2026-07-13)

| FR | Requirement | Verdict |
|----|---|---|
| FR1 | Dataset/result selection as source | DONE — catalog table picker (reuses Schema Intel's scanned catalog) |
| FR2 | Chart types (bar, line, area, pie, scatter, KPI, table) | DONE — all 7 via recharts, `ChartTypeSelector` grays out incompatible configs (e.g. pie needs exactly 1 dim + 1 measure) |
| FR3 | Dimensions, measures, aggregations | DONE — `POST /api/v1/viz/query` builds a real `GROUP BY` aggregation (sum/avg/count/min/max) against the connection |
| FR4 | Interactive filters and sorting | DONE — eq/neq/gt/lt/gte/lte/contains/between filters compiled to a parameterized `WHERE` clause; 300ms debounce on config change |
| FR5 | Interactive chart rendering | DONE — recharts tooltips/legend; loading/empty/error states in `ChartCanvas` |
| FR6 | Save/load named views | DONE — `VizView` model + `POST/GET/DELETE /api/v1/viz/views` |
| FR7 | Export PNG/CSV | DONE — client-side: CSV via Blob from already-fetched rows, PNG via SVG→canvas (no new dependency) |
| FR8 | Role-scoped data access | PARTIAL — query/view-read available to any authenticated user, view create/delete role-gated `admin`/`analyst` (matches every other module's pattern); no column-level masking applied to viz results yet — depends on `security_tasks` (not built this session, see that epic's INDEX.md) |

**7 of 8 FRs done, 1 partial pending the Security epic.**

## What was built (2026-07-13)

- `backend/app/models/viz.py` — `VizView` (name, connection_id, table_name, chart_type,
  dimensions/measures/filters as JSON).
- `backend/app/services/viz_service.py` — `VizService.run_query` (identifier-validated,
  parameterized-value SQL aggregation across sqlite/postgres/mysql/oracle/JDBC via the same
  connector abstraction as `pipeline_executor.py` and the schema_intel profiling connectors) +
  saved-view CRUD with audit events (`viz_view_created`, `viz_view_deleted`).
- `backend/app/api/routers/viz.py` — `POST /query`, `POST /views`, `GET /views`,
  `GET /views/{id}`, `DELETE /views/{id}`, mounted at `/api/v1/viz`.
- 19 new backend tests (`tests/viz/test_query.py`, `test_views.py`, `test_router.py`) covering
  aggregation correctness, every filter operator, SQL-injection-attempt rejection (identifier
  validation), role gating, and audit emission. Full backend suite 553/553 passing.
- Frontend: `frontend/src/app/dashboard/visualize/` rebuilt as a full charting workspace
  (`hooks/useVisualize.ts`, `components/{ChartTypeSelector,FieldConfigPanel,FilterBar,
  ChartCanvas,SaveViewDialog,ExportMenu,Toast}.tsx`), added `recharts` as a dependency. The
  pre-TRD ReactFlow topology graph moved verbatim to `/dashboard/visualize/topology`
  (sidebar + dashboard-home links updated to point there); nothing else in the frontend
  referenced the old route's matcher-adjacent behavior, so this was a clean relocation.
- Verified live end-to-end in Docker: catalog-driven field picker populated from a real
  Schema Intel scan (`crm_activities`), a bar chart and a KPI view both rendered real
  `SUM(id) = 15` aggregated from the seeded CRM SQLite demo data, a saved view round-tripped
  (save → appear in dropdown → reload), and CSV export produced a real downloaded file.

## Known scope limits (documented, not silent gaps)

- **Data source is catalog tables only**, not arbitrary Query Studio result sets (the TRD's
  "dataset source: Query Studio saved results OR connection+table" — only the second half is
  built). Wiring Query Studio's saved-query results as a second `POST /viz/query` input mode is
  a documented follow-up, not implemented this session.
- **Single dimension** drives bar/line/area charts (multiple dimensions work for the table view
  and the aggregation query itself, but the chart renderers use `dimensions[0]` as the category
  axis) — multi-dimension charting (e.g. stacked/grouped bars) is a follow-up.
- **No server-side row cap warning surfaced in the UI** beyond the `truncated` flag on very large
  result sets (FR spec's "Aggregated from N rows" indicator) — the flag is returned by the API
  and rendered in the table view's footer, but not yet on chart views.
- **Role-scoped data masking (FR8)** is not applied to `/viz/query` results — that depends on the
  Security epic's column-masking policies (`security_tasks/INDEX.md`, not built this session).

## Progress log

- 2026-07-13 — Epic built end-to-end in one session (backend aggregation engine + saved views,
  frontend charting page, topology graph relocation). No prior INDEX.md existed for this epic;
  this file establishes it going forward, following the `Pipelines_tasks`/`schema_intel_tasks`
  convention.
