# Dashboard — Bug Validation Report

> Validated against `TRD_DataPlane_Dashboard.md` (FR1–FR7) and implementation code as of commit `d2ea82b`.
> Status: 24 backend tests + 63 frontend vitest tests passing. All 7 FRs implemented (2026-07-07).
> 2026-07-09: #02, #03, #05 fixed; #04 found stale (already fixed pre-report); #01 reviewed and
> accepted as-is (see disposition below) — nothing left open in this report.

## Bug Summary

| # | Area | Severity | Status | Title |
|---|------|----------|--------|-------|
| 01 | Cache | **LOW** | **Reviewed — accepted, not fixed** | Cache is per-process (multi-worker gets N caches) — acceptable at 30s TTL, Redis flagged as future |
| 02 | Frontend | **LOW** | **Fixed 2026-07-09** | `useWidgetData` uses latest-wins request counter instead of AbortController — `api.get` has no signal param |
| 03 | Frontend | **LOW** | **Fixed 2026-07-09** | `onUnauthorized` single-handler-slot design is a latent footgun — second concurrent mount would clobber |
| 04 | Backend | **LOW** | **Stale — already fixed** | Per-module try/except in aggregation API must rollback per handler — a failed query poisons subsequent queries. Verified 2026-07-09 against current `dashboard_service.py`: every `except` block already routes through `_error_tile()` (or, for the feed block, an inline `db.rollback()`), and `_error_tile` itself calls `self.db.rollback()` before returning. This was fixed in the 2026-07-07 build (see `MEMORY.md`); this report predates that check. No code change made — re-flag only if a new handler is added without going through `_error_tile`. |
| 05 | Tests | **LOW** | **Fixed 2026-07-09** | No frontend component tests for dashboard widgets — Vitest infra was added but tests not written for all widgets |

## Resolutions (2026-07-09)

**#02 — AbortController.** `useWidgetData`'s fetcher signature changed from `() => Promise<T>`
to `(signal: AbortSignal) => Promise<T>`; the hook creates an `AbortController` per `load()`
call, aborts the previous one when a newer call supersedes it (refetch or deps change) and on
unmount, and passes `controller.signal` in. `api.get` gained an optional
`{ signal }` second argument forwarded straight to `fetch`. `page.tsx`'s three call sites
(`summary`, `drift`, `connectors`) now forward the signal. The existing request-counter guard
was kept as a second, cheaper check for any fetcher that doesn't wire the signal through — this
is additive, not a replacement. Tests: 2 new cases in `useWidgetData.test.tsx` (signal reaches
the fetcher; the superseded request's own signal is actually aborted, not just its result
discarded) + 2 in the new `lib/__tests__/api.test.ts` (signal forwarded to `fetch`; still works
with no options).

**#03 — multi-handler footgun.** `onUnauthorized: (() => void) | null` (a single nullable slot)
replaced with `const unauthorizedHandlers = new Set<() => void>()`. New API:
`addUnauthorizedHandler(fn)` returns an unregister function; `handle401` iterates the set,
isolating each handler in its own try/catch (one throwing must not block the others — same
reasoning as the original single-handler contract, just now correct for N handlers). The one
existing caller (`useMapping.ts`) migrated from `setUnauthorizedHandler(fn)` /
`setUnauthorizedHandler(null)` to `const remove = addUnauthorizedHandler(fn)` / `remove()` — no
behavior change for the mapper, since it was the only registrant. `setUnauthorizedHandler` was
deleted rather than kept as a compatibility shim (repo convention: don't keep dead/renamed APIs
around when there's exactly one caller to update). Tests: 3 new cases in `lib/__tests__/api.test.ts`
(all handlers fire; a throwing handler doesn't block others; unregister removes only its own
handler and leaves a still-mounted feature's handler intact).

**#05 — missing widget tests.** Re-verified first: `KPITile`, `DashboardWidget`, `ActivityFeed`,
`TimeRangeFilter`, and `useWidgetData` all already had test files (this line item was written
before or without checking that). The real, remaining gap was `page.tsx` itself (237 lines of
composition/wiring — range persistence, polling pause conditions, skeleton-tile rendering,
drift-banner visibility, connector health probing) having zero coverage. Added
`__tests__/page.test.tsx` (9 tests): skeleton→real-tile transition, error banner + Retry
re-fetch, drift banner shown/hidden (including hidden-on-widget-error, not just
hidden-on-empty), range selection persists to `localStorage` and re-fetches with the new range,
a valid persisted range is honored on mount, and the connector health probe renders live
Connected/Failed status per connector from `POST /connectors/{id}/test`.

**#01 — per-process cache — reviewed, not fixed.** The report's own framing ("acceptable at 30s
TTL, Redis flagged as future") already states this is a deliberate, accepted tradeoff, not a
defect. Confirmed against `dashboard_service.py`/`dashboard_cache.py`: at a 30s TTL, the
worst case is N processes each doing one extra DB round-trip within a 30s window — bounded,
cheap, and self-correcting. Implementing Redis-backed caching now would mean adding a new
runtime dependency on the `broker` Redis instance for a *different* purpose than Celery
already uses it for, changing production cache-invalidation semantics, with no observed
problem driving it — exactly the "don't design for hypothetical future requirements" case.
**Left open by design; revisit only if multi-worker cache staleness is actually observed in
production**, not preemptively.

Verification for all four: backend suite unaffected (frontend-only change); frontend
`tsc --noEmit` clean, `npm test` 63/63 (16 new: 4 in `api.test.ts`, 3 in `useWidgetData.test.tsx`,
9 in `page.test.tsx`), `npm run lint` at the pre-existing 29-problem baseline, `npm run build`
clean.

## FR Coverage Verification

| FR | Requirement | Status | Task(s) |
|----|------------|--------|---------|
| FR1 | Dashboard as default route after authentication | ✅ Done | — |
| FR2 | KPI tiles for active connectors, running/failed pipelines, queries, security alerts | ✅ Done | #1, #4 |
| FR3 | Recent activity feed of latest N events across modules | ✅ Done | #1, #5 |
| FR4 | Time-range filter (24h / 7d / 30d) for all time-sensitive widgets | ✅ Done | #6 |
| FR5 | Each KPI tile and feed item links to relevant module/detail view | ✅ Done | #4, #5 |
| FR6 | Distinct loading, empty, and error states per widget without failing the whole page | ✅ Done | #3 |
| FR7 | Dashboard data reflects only resources the user's role is permitted to view | ✅ Done | #7 |

## Spec Deviations (Code Won — Documented)

| Deviation | Spec Said | Code Does | Rationale |
|-----------|-----------|-----------|-----------|
| Pipeline state | `Pipeline.status` | `PipelineRun.status` | Pipeline state lives on runs, not the pipeline entity |
| "Queries Today" tile | Named "Queries Today" | Named "Queries" with dynamic range subtitle | Range semantics make "Today" wrong for 7d/30d |
| Anonymous access | Viewer-filtering | 401 (auth required) | Auth required for all endpoints |
| Cache dependency | `cachetools` already installed | Added `cachetools==7.1.4` | Was not in requirements.txt |