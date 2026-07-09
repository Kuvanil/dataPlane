# Dashboard — Bug Validation Report

> Validated against `TRD_DataPlane_Dashboard.md` (FR1–FR7) and implementation code as of commit `d2ea82b`.
> Status: 24 backend tests + 35 frontend vitest tests passing. All 7 FRs implemented (2026-07-07).

## Bug Summary

| # | Area | Severity | Status | Title |
|---|------|----------|--------|-------|
| 01 | Cache | **LOW** | Open | Cache is per-process (multi-worker gets N caches) — acceptable at 30s TTL, Redis flagged as future |
| 02 | Frontend | **LOW** | Open | `useWidgetData` uses latest-wins request counter instead of AbortController — `api.get` has no signal param |
| 03 | Frontend | **LOW** | Open | `onUnauthorized` single-handler-slot design is a latent footgun — second concurrent mount would clobber |
| 04 | Backend | **LOW** | **Stale — already fixed** | Per-module try/except in aggregation API must rollback per handler — a failed query poisons subsequent queries. Verified 2026-07-09 against current `dashboard_service.py`: every `except` block already routes through `_error_tile()` (or, for the feed block, an inline `db.rollback()`), and `_error_tile` itself calls `self.db.rollback()` before returning. This was fixed in the 2026-07-07 build (see `MEMORY.md`); this report predates that check. No code change made — re-flag only if a new handler is added without going through `_error_tile`. |
| 05 | Tests | **LOW** | Open | No frontend component tests for dashboard widgets — Vitest infra was added but tests not written for all widgets |

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