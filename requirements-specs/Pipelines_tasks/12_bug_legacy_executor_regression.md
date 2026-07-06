# Bug #12 — Legacy `POST /execute` executor destroyed by Task #1 refactor (CRITICAL)

**Found by:** 2026-07-06 code review of commit `3866c7e` (Tasks #1 + #2).
**Contradicts:** Task #1 spec ("the current `execute_pipeline` method stays, untouched, until
Task #3 replaces it") and the commit message ("The legacy execute_pipeline graph executor stays
untouched"). The diff shows the opposite — 443 deletions in `pipeline_service.py`.

## Current state

The pre-commit `pipeline_service.py` (HEAD~1, 536 lines) had a complete legacy executor:
`_validate_graph`, `_build_adjacency`, `_has_path`, `_load_connections`, `_run_ai_matching`,
`_build_mapping_rules`, `_create_target_on_the_fly`, `_execute_target_migration`,
`_run_identity_matching`. All nine helpers were deleted; what remains at
`backend/app/services/pipeline_service.py` is a mangled hybrid that:

1. Calls `PipelineService._validate_graph(...)` and `._load_connections(...)` — deleted →
   instant `AttributeError` on any call.
2. Ends with `return table_mappings, unmatched_source, unmatched_target` where
   `unmatched_source` is **never defined** (a copy-paste of `_run_identity_matching`'s tail) →
   `NameError` even if (1) were fixed; also returns a tuple where the router
   (`pipelines.py`, `result.get("source")`) expects a dict.
3. Lost the entire DDL / data-copy path (`rows_copied` no longer exists anywhere).

Net effect: `POST /api/v1/pipelines/execute` — which the live `/dashboard/pipelines` UI is
wired to — 500s on every call. The test suite stayed green because nothing tests `/execute`.

## Fix

Restore the legacy executor block **verbatim from HEAD~1** (`git show
HEAD~1:backend/app/services/pipeline_service.py`): the full `execute_pipeline` body plus all
nine helper methods, coexisting with the new Task #1/#2 surface (`compute_schema_hash`,
`_resolve_published_version`, `PipelineCRUD`). Do not "improve" the legacy code while
restoring — Task #3 replaces it wholesale; the point is a clean swap target.

Add a minimal regression test so the executor's import-time/call-time integrity is covered
until Task #3 retires it (e.g. invalid graph → `ValueError`, and a monkeypatched happy path
asserting the dict envelope shape with `rows_copied`).

## Verify

```bash
cd backend && .venv/bin/pytest tests/pipelines/ -v
```
Plus: `POST /pipelines/execute` with a bad graph returns 400 (not 500 AttributeError).

## Risk

Low — restoring previously-shipped code verbatim. The only judgment is keeping the new
module-level names (Task #1/#2) from colliding with restored ones.
