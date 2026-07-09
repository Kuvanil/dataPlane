# AI Autopilot — Bug Validation Report

> Validated against `TRD_DataPlane_AI_Autopilot.md` (FR1–FR9, AC1–AC4) and the implementation code as of commit `d2ea82b`.
> Status: 65/65 tests passing. All FRs and ACs are covered by tests and functionally verified.
>
> **2026-07-09: all 5 bugs FIXED** — one dedicated regression test per bug (6 new tests; suite
> 335/335). Per-bug resolution notes are appended to each bug file. Generalized lessons are in
> [notes.md](notes.md) — read that before building the next epic.

## Bug Summary

| # | File | Severity | Status | Title |
|---|------|----------|--------|-------|
| [01](01_executor_commits_caller_session.md) | `autopilot_registry.py:160` | **Medium** | Fixed | `_exec_migration_execute` commits caller's session, breaking transaction atomicity |
| [02](02_engine_crashes_on_registry_mismatch.md) | `autopilot_engine.py:218-227` | **Low** | Fixed | Engine crashes if registry removes an action type evaluators still reference |
| [03](03_demote_python_object_stale.md) | `autopilot_service.py:471-477` | **Low** | Fixed | `synchronize_session=False` in `_demote_to_queue` leaves stale Python object |
| [04](04_evaluator_drift_query_no_pagination.md) | `autopilot_engine.py:103-108` | **Low** | Fixed | `_evaluate_schema_drift` loads all drift events without pagination |
| [05](05_action_log_outcome_missing_blocked_reason.md) | `autopilot_service.py:465-469` | **Low** | Fixed | `_demote_to_queue` action log omits structured `blocked_by` field, making audit queries brittle |

## Coverage Verification

| Requirement | Covered? | Test Evidence |
|-------------|----------|---------------|
| FR1 — Policy per action type | ✅ | `test_policy.py` (8 tests) |
| FR2 — Recommendations w/ rationale + confidence | ✅ | `test_engine.py` (6 tests) |
| FR3 — Approval queue | ✅ | `test_queue_executor.py` (11 tests) |
| FR4 — Bounded autonomous execution | ✅ | `test_safety_guardrails.py::test_ac4_*` |
| FR5 — Hard prohibitions | ✅ | `test_safety_guardrails.py::test_ac3_*`, `test_registry.py` |
| FR6 — Action log | ✅ | `test_queue_executor.py::test_executor_happy_path*`, `test_safety_guardrails.py` |
| FR7 — Approve/reject/modify | ✅ | `test_queue_executor.py` (modify, reject, approve tests) |
| FR8 — Rate/volume limits | ✅ | `test_limits_breaker.py` (7 tests) |
| FR9 — Audit events | ✅ | `test_safety_guardrails.py::test_full_lifecycle_audit_order` |
| AC1 — Suggest-only never executes | ✅ | `test_safety_guardrails.py::test_ac1_*` |
| AC2 — Approval gate | ✅ | `test_safety_guardrails.py::test_ac2_*` |
| AC3 — Prohibited hard-block | ✅ | `test_safety_guardrails.py::test_ac3_*` (3 variants) |
| AC4 — Bounded auto execution | ✅ | `test_safety_guardrails.py::test_ac4_*` |