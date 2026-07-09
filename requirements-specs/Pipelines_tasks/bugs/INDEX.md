# Pipelines — Bug Validation Report

> Validated against `TRD_DataPlane_Pipelines.md` (FR1–FR10) and implementation code as of commit `d2ea82b`.
> Status: 41/41 tests passing. 2 of 10 FRs done (FR1, FR2); 8 FRs not yet built (spec-ready).
> Bugs #12–#19 were found and fixed during the 2026-07-06 code review of commit `3866c7e`.

## Bug Summary

| # | File | Severity | Status | Title |
|---|------|----------|--------|-------|
| [12](12_bug_legacy_executor_regression.md) | `pipeline_service.py` | **CRITICAL** | Fixed | Legacy `POST /execute` executor destroyed by Task #1 refactor |
| [13](13_bug_index_status_inflation.md) | `INDEX.md` | **HIGH** | Fixed | INDEX.md status inflation (specs marked as shipped FRs) |
| [14](14_bug_mapping_connection_validation.md) | `pipeline_service.py` | **HIGH** | Fixed | `create_pipeline` accepts mappings from different connections |
| [15](15_bug_drift_hash_order_dependence.md) | `diff_service.py` | **MEDIUM** | Fixed | Drift hashes column-order-dependent, contradicts `has_drift` |
| [16](16_bug_schemas_equal_duplicates.md) | `diff_service.py` | **MEDIUM** | Fixed | `_schemas_equal` mishandles duplicates / asymmetric |
| [17](17_bug_empty_snapshot_silent_pass.md) | `pipeline_service.py` | **MEDIUM** | Fixed | Empty baseline snapshot silently disables drift detection |
| [18](18_bug_changed_tables_misses_columns.md) | `diff_service.py` | **MEDIUM** | Fixed | `changed_tables` misses column-level drift |
| [19](19_bug_cleanup_batch.md) | Various | **LOW** | Fixed | Cleanup batch (dead `get_run`, unused imports, `Boolean`, `uselist`) |

## FR Coverage Verification

| FR | Requirement | Status | Task(s) |
|----|------------|--------|---------|
| FR1 | Create pipeline from source/target/published mapping | ✅ Done | #1 |
| FR2 | Drift validation pre-run | ✅ Done | #2 |
| FR3 | Manual run | ❌ Not built | #3 |
| FR4 | Cron schedule + enable/disable | ❌ Not built | #4 |
| FR5 | Execute E-T-L, report status/progress/row counts | ❌ Not built | #3 |
| FR6 | Run history | ⚠️ Partial — models + list endpoint exist, no runs produced | #1, #6 |
| FR7 | Configurable retry on transient failure | ❌ Not built | #5 |
| FR8 | Re-run a past run | ❌ Not built | #6 |
| FR9 | Audit events | ⚠️ Partial — CRUD audited; run/schedule endpoints don't exist | #8 |
| FR10 | Role-gate create/run/disable | ⚠️ Partial — CRUD gated; run/disable endpoints don't exist | #8, #10 |

## New Bugs Found (2026-07-09)

| # | File | Severity | Title |
|---|------|----------|-------|
| [20](20_no_execution_engine.md) | N/A | **HIGH** | Execution engine (#3) not built — 0% of FR3/FR5 implemented |
| [21](21_no_scheduler.md) | N/A | **HIGH** | Scheduler (#4) not built — 0% of FR4 implemented |
| [22](22_no_retry_handling.md) | N/A | **MEDIUM** | Retry/failure handling (#5) not built — 0% of FR7 implemented |
| [23](23_no_run_history_production.md) | `pipeline_service.py` | **MEDIUM** | Run history model exists but no code produces runs — FR6/FR8 0% |
| [24](24_no_concurrency_control.md) | N/A | **MEDIUM** | Concurrency/queueing (#9) not built — no run queueing exists |
| [25](25_no_api_role_gating_tests.md) | `tests/pipelines/` | **LOW** | No API-level role-gating tests — only code inspection asserts gating |

Note: Bugs #20-#25 are known gaps correctly documented as `[~]` or `[ ]` in the INDEX.md. They are not regressions — they are unimplemented features.