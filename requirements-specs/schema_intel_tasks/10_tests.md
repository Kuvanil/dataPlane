# Task #10 — Test suite (SI-T8)

**TRD reference:** §6 SI-T8, §12 Definition of Done ("Unit/integration/E2E tests passing", "FR1–FR8
implemented and verified").

**Current state:** `backend/tests/schema_catalog/` does not exist. No existing test file exercises
`SchemaService`, `SecurityService`, `DiffService`, or `check_schema_drift_task` — confirmed by
grep: `backend/tests/mapping/` (the only substantial test directory in the repo) contains zero
references to `schema_service`, `security_service`, or `schema_snapshot`. 0 tests exist today for
discovery, profiling, classification, drift, search, or override.

## Scope

Create `backend/tests/schema_catalog/` mirroring the structure of `backend/tests/mapping/`, one
file per task in this directory:

- `test_discovery.py` (Task #1 — including regression coverage for the Postgres/Oracle PK bug fix)
- `test_profiling.py` (Task #2)
- `test_classification.py` (Task #3)
- `test_search.py` (Task #4)
- `test_drift.py` (Task #6)
- `test_override.py` + audit-payload assertions (Task #7)

Each task's own file above already lists its specific test cases — this task is the umbrella that
ensures they land as a cohesive suite and that FR1–FR8 each have at least one asserting test by the
time every task in this directory is done.

Frontend (Task #5) has no component-test harness in this repo yet (same pre-existing gap noted in
`Pipelines_tasks/10_tests.md` and true for Schema Mapper's Canvas) — cover it via
`npx tsc --noEmit` + `npm run build` + manual QA per Task #5's verify section, not a new automated
harness, unless the project takes on a frontend test harness project-wide.

## Dependencies

All of Tasks #1, #2, #3, #4, #6, #7 — produced incrementally alongside each, not written as one
final pass. Treat "tests for a task" as part of that task's own definition of done; this file is
the tracking/rollup point confirming nothing was skipped.

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/ -v
```
Target: every test passes, and cross-check the FR1–FR8 table (this directory's `INDEX.md`) against
which test file covers which FR — any FR with no corresponding test is not done, no matter what
the code looks like.

## Risk

Low as a standalone task; its real risk is becoming an end-of-project afterthought instead of
incremental per-task work — the same failure mode `Pipelines_tasks/10_tests.md` flagged for its
own epic, worth avoiding here too rather than repeating.
