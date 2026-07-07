# Dashboard (DP-DASH-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Dashboard.md` (7 FRs, 8 subtasks DASH-T1–T8, ~20 person-days estimated).
> Scope: backend `GET /api/v1/dashboard/summary` aggregation endpoint + caching + frontend widget framework +
> KPI tiles + activity feed + time-range filter + role-scoping + tests.
>
> **2026-07-06 TRD-vs-implementation audit.** Unlike Pipelines (0/10 FRs done) or Schema Intel (2/8 FRs done),
> the Dashboard has a **partial frontend implementation** from `dashboard_static_ui_tasks/` that wired the
> home page to live individual endpoints (connectors list, audit summary, mappings count, per-connector test)
> as a band-aid fix for hardcoded string literals. What does **not** exist:
>
> - A dedicated aggregation API (`GET /api/v1/dashboard/summary`) — the frontend makes 3–4 separate calls on load
> - A caching layer for dashboard summaries
> - A proper widget framework with isolated loading/empty/error/partial-failure states per widget
> - A time-range filter (24h / 7d / 30d)
> - Role-scoping on dashboard data (the individual endpoints are gated, but the dashboard has no unified scope)
> - Drill-through navigation from every widget to its owning module
> - A dedicated test suite for dashboard endpoints
>
> The `dashboard_static_ui_tasks/` work is acknowledged as a tactical fix; this directory covers the
> **proper implementation** per the TRD.

## FR1–FR7 verdict (as of 2026-07-06 audit)

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | Dashboard as default route after authentication | DONE (Next.js route config) | — |
| FR2 | KPI tiles for active connectors, running/failed pipelines, queries, security alerts | PARTIAL — frontend shows connectors + mappings + audit + drift counts from individual calls, but no pipelines-running/failed, no queries-today, no security-alerts tiles; no unified aggregation API | #1, #4 |
| FR3 | Recent activity feed of latest N events across modules | PARTIAL — frontend shows audit events from `GET /audit/`, but not enriched with module-specific context; no aggregation API | #1, #5 |
| FR4 | Time-range filter (24h / 7d / 30d) for all time-sensitive widgets | NOT DONE — no filter exists anywhere | #6 |
| FR5 | Each KPI tile and feed item links to relevant module/detail view | NOT DONE — no drill-through navigation exists | #4, #5 |
| FR6 | Distinct loading, empty, and error states per widget without failing the whole page | PARTIAL — basic loading/error states exist from `dashboard_static_ui_tasks/`, but not per-widget isolation; one failed fetch can still degrade the whole page | #3 |
| FR7 | Dashboard data reflects only resources the user's role is permitted to view | PARTIAL — individual endpoints are role-gated, but the dashboard has no unified role-scoping; aggregation API must respect the same gates | #7 |

**0 of 7 FRs fully done, 4 partial, 1 not started (FR4), 2 partially covered by tactical frontend work (FR2, FR3).**

> **2026-07-07 update:** FR1–FR7 all implemented (see progress log). FR2/FR3 via the aggregation API + KPI/feed widgets, FR4 via the range filter, FR5 via tile/feed drill-through links, FR6 via `DashboardWidget` isolation + per-tile `status`, FR7 via server-side role masking. #8 closed same day (Vitest infra approved by user). Remaining DoD gap: tenant isolation sign-off (#9, cross-team).

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Task list

| # | TRD ref | Status | Title |
|---|---------|--------|-------|
| [01](01_aggregation_api.md) | FR2, FR3, §11 | [x] | Aggregation API — `GET /api/v1/dashboard/summary` returning KPIs + feed in one payload |
| [02](02_caching_layer.md) | Performance NFR, §10 risk table | [x] | Caching layer for dashboard summaries (per-tenant, short TTL) |
| [03](03_widget_framework_and_states.md) | FR6, Reliability NFR | [x] | Widget framework with isolated loading/empty/error/partial-failure states |
| [04](04_kpi_tiles_and_drill_through.md) | FR2, FR5 | [x] | KPI tiles with drill-through navigation to each module |
| [05](05_activity_feed_widget.md) | FR3, FR5 | [x] | Activity feed widget with module-context enrichment and drill-through |
| [06](06_time_range_filter.md) | FR4 | [x] | Time-range filter (24h / 7d / 30d) applied to all time-sensitive widgets |
| [07](07_role_scoping.md) | FR7, Security NFR | [x] | Role-scoping — dashboard data filtered by user's permissions |
| [08](08_tests.md) | §12 DoD | [x] | Test suite — backend (24 pytest) + frontend (35 Vitest/RTL; infra added 2026-07-07 per user sign-off) |
| [09](09_tenant_isolation_signoff.md) | §9 assumption / DoD | [!] | Tenant isolation — cross-reference, not a new task |

## Confidence per task (auto-mode implementation)

- **#1 Aggregation API** — HIGH confidence. Standard FastAPI endpoint that fans out to existing module APIs/services (connectors, pipelines, audit, mappings, autopilot, query history) and aggregates results. Mirrors the pattern of `schema_catalog_service.py`'s `scan_connection` which also fans out to multiple sources. The main risk is the number of downstream calls (6+ modules) and how partial failures are handled — each module call must be wrapped in try/except with a per-module fallback so one down module doesn't kill the whole dashboard.
- **#2 Caching layer** — MEDIUM confidence. Per-tenant cache keyed by range with short TTL. The codebase has no caching precedent yet (first implementation), so this needs a lightweight in-process cache (e.g. `cachetools.TTLCache`) rather than introducing Redis. The risk is cache invalidation: if a connector is added/deleted, the dashboard cache should be invalidated or have a short enough TTL that staleness is acceptable. Recommend 30s TTL for the first implementation.
- **#3 Widget framework + states** — HIGH confidence. Frontend-only work. Each widget is a self-contained component that receives its slice of the aggregation API response and manages its own loading/empty/error state. The `dashboard_static_ui_tasks/` work already established a pattern for this — this task formalizes it into a reusable `DashboardWidget` wrapper component.
- **#4 KPI tiles + drill-through** — HIGH confidence. Each tile is a `Link` wrapping a stat card. The aggregation API provides the counts; the frontend maps each count to a route path. Edge cases: zero counts (show "0", not "—"), very large counts (format with locale separators), loading state (skeleton shimmer), error state (show "—" with a tooltip explaining the error).
- **#5 Activity feed widget** — HIGH confidence. Consumes the `feed` array from the aggregation API. Each item has `event_type`, `actor`, `module`, `summary`, `created_at`, `link_url`. The frontend renders them in reverse-chronological order with relative timestamps, category icons, and failure tinting. Edge cases: empty feed (empty state message), very long feed (truncate to N items with "view all" link), real-time updates (polling interval).
- **#6 Time-range filter** — HIGH confidence. A segmented control (24h / 7d / 30d) that re-fetches the aggregation API with the selected range. The aggregation API accepts `?range=24h|7d|30d`. Edge cases: rapid switching (debounce, abort previous request), range with no data (empty states per widget), default selection (7d).
- **#7 Role-scoping** — MEDIUM confidence. The aggregation API must filter results based on the authenticated user's role. The existing `require_role` dependency from `backend/app/api/deps.py` is already used by other endpoints — this task applies the same pattern to the dashboard aggregation endpoint. The risk is that some module APIs don't support role-scoped queries yet, so the aggregation layer may need to post-filter.
- **#8 Tests** — MEDIUM confidence. Integration tests for the aggregation API need mocked module services (or a real DB with seed data). The existing `conftest.py` patterns (in-memory SQLite, test client) apply. The caching layer tests need to verify TTL expiry and cache invalidation.
- **#9 Tenant isolation** — [!] blocked, cross-reference to the same app-wide gap already flagged in `mapper_tasks/07`, `schema_intel_tasks/09`, and `connector_tasks/10`. Not re-litigated here.

## Execution order (recommended)

1. **#1 Aggregation API** — everything else depends on this unified endpoint.
2. **#2 Caching layer** — wraps #1; can land in the same PR or immediately after.
3. **#3 Widget framework + states** — frontend foundation; needed by #4, #5, #6.
4. **#4 KPI tiles + drill-through** — depends on #1 and #3.
5. **#5 Activity feed widget** — depends on #1 and #3.
6. **#6 Time-range filter** — depends on #4 (adds range param to the aggregation API call).
7. **#7 Role-scoping** — applied to #1's aggregation logic; can land alongside #1 or after.
8. **#8 Tests** — incremental, applied as each task's endpoints land.
9. **#9 Tenant isolation sign-off** — cross-team, pursue in parallel; don't block other tasks on it but don't mark the Security DoD satisfied without it either.

## Out of scope (confirmed, per TRD §2)

- Custom dashboard builder / draggable widgets (future enhancement).
- Editing or executing actions directly from the dashboard (read-only surface).
- Detailed module data (owned by each respective module).
- Real-time WebSocket push for live-updating widgets (future enhancement; use polling for now).
- Custom time ranges beyond the predefined 24h/7d/30d options.

## Progress log

- 2026-07-07 (later) — **Task #8 closed; demo data seeded** (both user-approved). Frontend test infra: Vitest + React Testing Library per this Next version's bundled vitest guide (`vitest.config.mts`, `vitest.setup.ts`, `npm test` / `test:watch` scripts; devDeps vitest/@vitejs/plugin-react/jsdom/@testing-library/{react,dom,jest-dom}/vite-tsconfig-paths). 35 tests in `src/app/dashboard/__tests__/` covering KPITile (formatting, drill-through vs non-clickable error tiles, trend rules), TimeRangeFilter (a11y radiogroup, fallback), DashboardWidget (state precedence, retry), ActivityFeed (truncation, failure tint, unknown-event fallback), useWidgetData (latest-wins stale-drop, refetch recovery, deps refetch). All pass; tsc/build clean; lint still at the 30-problem baseline. Gotcha: `act(() => asyncFn())` without await leaks React 19's act scope and makes `result.current` null in *subsequent* tests — always `await act(async () => ...)` for async callbacks. Backend coverage measured (pytest-cov, installed in venv only — not pinned): 90% overall (router/schemas/cache 100%, service 84%). Demo seed: idempotent script run in the api container (guard: `AuditLog.actor == "demo-seed"`) — 1 published mapping+version, 1 pipeline, 6 runs (running/failed×2/succeeded×3), 9 queries, 10 audit events, 3 autopilot runs, spread across 24h/7d/30d so range scoping is visible (Queries 3→6→9, Failed 1→2, Autopilot 1→2→3, all verified live). All 8 tiles now non-zero for admin. Data is in the dev Postgres volume only, tagged `demo-seed` for easy deletion.

- 2026-07-06 — TRD-vs-implementation audit run. Found `dashboard_static_ui_tasks/` tactical fixes already in place (5 tasks, all done). This directory created with 9 numbered tasks covering the remaining TRD gaps. No implementation started yet.
- 2026-07-07 — **Tasks #1–#7 implemented, #8 backend-complete.** Backend: `GET /api/v1/dashboard/summary?range=24h|7d|30d` (new `schemas/dashboard.py`, `services/dashboard_service.py`, `services/dashboard_cache.py`, `routers/dashboard.py`, wired in `main.py`); 8 KPI tiles + 10-item enriched feed; per-module try/except isolation **with session rollback in each handler** (a failed query would otherwise abort the transaction and poison every subsequent module query — the spec pseudocode missed this); `cachetools.TTLCache` keyed `user_id:range`, 30s TTL via `settings.DASHBOARD_CACHE_TTL` (TTL≤0 disables; new dep `cachetools==7.1.4` — spec wrongly claimed it was already installed); viewer/unknown roles get security+autopilot tiles masked as `unavailable` placeholders and restricted feed items dropped (least-privilege default). Frontend: `DashboardWidget` + `useWidgetData` (per-widget isolated states; stale responses dropped via latest-wins request counter instead of AbortController since `api.get` has no signal param), `KPITile` (drill-through Links on loaded tiles only, k/M formatting), `ActivityFeed` (module icons, failure tint, 8-item cap + "view all" → /dashboard/audit, 30s polling paused on hidden tab/loading/error), `TimeRangeFilter` (segmented radiogroup, localStorage persistence, disabled while loading); `page.tsx` rewired to the aggregation API, keeping drift-alert details, quick actions, and per-connector health probes as isolated widgets. **Spec deviations (code won):** no `DBConnection.is_deleted` (count all); pipeline state lives on `PipelineRun.status` not `Pipeline` (running = current running/retrying, failed = range-scoped by `finished_at`); `Mapping` filtered on `deleted_at`; Query Studio route is `/dashboard/query-studio` not `/dashboard/query`; "Queries Today" tile renamed "Queries" with a dynamic range subtitle (the spec's own range semantics make "Today" wrong for 7d/30d); anonymous → 401 (auth required), not viewer-filtering. Verification: pytest 191/191 (24 new in `tests/dashboard/`), tsc/lint/build clean (lint = 30-problem pre-existing baseline, zero new), api+frontend images rebuilt and exercised live (200 happy path with real data, 422 bad range, 401 anon, feed enrichment + deep links confirmed). **Caveats:** Task #8 frontend component tests NOT written — no jest/React Testing Library infra exists despite the spec claiming it does; adding a test framework is a human call → #8 left `[~]`. Cache is per-process (multi-worker gets N caches — acceptable at 30s TTL, Redis flagged as future work). Uncommitted; working tree also holds unrelated staged mapping/schema-mapper work.