# Schema Intel — Bug Validation Report

> Validated against `TRD_DataPlane_Schema_Intel.md` (FR1–FR8) and implementation code as of commit `d2ea82b`.
> Status: All backend tests passing. 2 of 8 FRs done (FR1, FR6); 3 partial; 3 not started.

## Bug Summary

| # | Area | Severity | Status | Title |
|---|------|----------|--------|-------|
| 01 | `postgres.py` | **MEDIUM** | Fixed | Hardcoded `primary_key: False` in Postgres connector — PKs not recognized |
| 02 | `oracle.py` | **MEDIUM** | Fixed | Hardcoded `primary_key: False` in Oracle connector real branch — PKs not recognized |
| 03 | `connectors/*.py` | **LOW** | Fixed | FK discovery missing from all 5 connectors — added via catalog queries/PRAGMA |
| 04 | Profiling | **HIGH** | Not started | Column profiling (FR2) — zero code exists anywhere |
| 05 | Classification | **MEDIUM** | [?] Open | Classification (FR3) has no confidence scoring, no value-based detection |
| 06 | Catalog search | **MEDIUM** | Not started | Catalog search API (FR4) — no `q`/filter params on GET endpoint |
| 07 | Catalog UI | **MEDIUM** | Not started | Catalog UI + classification badges (FR5) |
| 08 | Manual override | **LOW** | Not started | Manual classification override + audit (FR5/FR8) |
| 09 | Profiling sample bounds | **MEDIUM** | Not started | Bounded-sample profiling (FR7) — depends entirely on FR2 |
| 10 | PII sign-off | **HIGH** | [!] Blocked | PII data-safety sign-off — needs Security decision on sample minimization |
| 11 | Tenant isolation | **HIGH** | [!] Blocked | Tenant isolation — app-wide cross-reference |

## FR Coverage Verification

| FR | Requirement | Status | Task(s) |
|----|------------|--------|---------|
| FR1 | Discover and persist schema structure (tables, columns, types, keys) | ✅ Done | #1 |
| FR2 | Profile each column: null rate, distinct count, min/max | ❌ Not started | #2 |
| FR3 | Classify columns into sensitive categories with confidence score | ⚠️ Partial — keyword rules exist, no confidence, no value-based detection | #3 |
| FR4 | Search/filter the catalog by table, column, type, classification | ⚠️ Partial — `GET /catalog/{id}/tables` exists, no `q`/filter params | #4, #5 |
| FR5 | Manual override of classification, audited | ❌ Not started | #7 |
| FR6 | Re-scan + drift detection, highlighting added/removed/changed elements | ✅ Done | #6 |
| FR7 | Bounded-sample profiling with configurable, enforced sample limits | ❌ Not started — depends on FR2 | #2 |
| FR8 | Audit events for scans, classifications, and overrides | ⚠️ Partial — scan/drift/classify audited; override doesn't exist | #7 |

## Key Architectural Gaps

1. **No profiling infrastructure (#2):** The largest remaining gap. No sampling, no `COUNT(DISTINCT ...)`, no NULL-rate calculation, no min/max. The TRD's "bounded sample" constraint (FR7) adds compliance complexity — must enforce configurable row limits per column per scan.

2. **Classification is heuristic-only (#3):** The existing keyword/substring matcher never inspects actual data values. AC2's example (email-formatted column, not just one named "email") requires #2's sampled data plus regex/pattern matching. No confidence score is attached to classifications.

3. **No catalog search UI (#4/#5):** The `GET /catalog/{id}/tables` endpoint returns all tables for a connection with no search/filter. No frontend page exists to browse the catalog.

4. **No manual override (#7):** Classifications are recomputed on every request — nothing to override. The audit mechanism exists but has no override event to emit.