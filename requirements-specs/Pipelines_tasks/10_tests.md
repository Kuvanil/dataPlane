# Task #10 — Test suite (PIPE-T9)

**TRD reference:** §6 PIPE-T9, §12 Definition of Done ("Unit/integration/E2E tests passing",
"FR1–FR10 implemented and verified").

**Current state (updated 2026-07-06):** `backend/tests/pipelines/` now exists with 41 tests:
`test_pipeline_crud.py` (Task #1 + Bug #14), `test_drift_validation.py` (Task #2 + bugs
#15–#18), `test_legacy_executor.py` (Bug #12 regression pin). All are **service-level** —
nothing exercises the HTTP router, so `require_role` gating on the pipeline endpoints has zero
coverage. Remaining files below land with their tasks.

## Scope

Create `backend/tests/pipelines/` mirroring the structure of `backend/tests/mapping/`, with one
file per task in this directory rather than one giant test file:

- `test_pipeline_crud.py` (Task #1)
- `test_drift_validation.py` (Task #2)
- `test_execution_engine.py` (Task #3)
- `test_scheduler.py` (Task #4)
- `test_retry.py` (Task #5)
- `test_run_history.py` (Task #6)
- `test_concurrency.py` (Task #9)
- `test_role_gating.py` + `test_audit_emission.py` (Task #8) — **must be API-level
  (FastAPI TestClient), not service-level** (added per Bug #19 item 6): assert viewer is 403'd
  on create/update/delete and analyst is 403'd on delete. Task #8's stated risk is "forgetting
  to gate a newly-added endpoint", which only TestClient tests catch.

Each task's own file above already lists its specific test cases — this task is the umbrella
that ensures they land as a cohesive, run-together suite rather than scattered ad hoc, and that
the full FR1–FR10 checklist in the TRD has at least one asserting test per FR by the time all
tasks in this directory are done.

Frontend (Task #7) has no component-test harness in this repo yet (a pre-existing gap, also true
for Schema Mapper's Canvas) — cover it via `npx tsc --noEmit` + `npm run build` + manual QA per
Task #7's verify section, not a new automated harness, unless the project takes on a frontend
test harness project-wide.

## Dependencies

All of Tasks #1–#9 — this task's content is produced incrementally alongside each, not written
as one final pass at the end. Treat "test suite for a task" as part of that task's definition of
done, and this file as the tracking/rollup point confirming nothing was skipped.

## Verify

```bash
cd backend && .venv/bin/pytest tests/pipelines/ -v
```
Target: every test passes, and cross-check the FR1–FR10 table (this directory's `INDEX.md`)
against which test file covers which FR — any FR with no corresponding test is not done, no
matter what the code looks like.

## Risk

Low as a standalone task; its real risk is being treated as an end-of-project afterthought
instead of incremental per-task work, which is how the current 0-tests state came to exist
despite `Pipelines_tasks/INDEX.md` (v1) already naming PIPE-T9 as its own subtask.
