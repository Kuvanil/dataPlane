# Bug #17 — Empty baseline snapshot silently disables drift detection (MEDIUM)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Affects FR2 / AC2 invariant.

## Current state

`PipelineCRUD.validate_drift`:
`has_drift = not _schemas_equal(live_source, snapshot) if snapshot else False`.
A pinned `MappingVersion` whose `schema_snapshot["source"]` is missing or empty yields
"no drift detected" **forever** — the check is silently disabled for that pipeline. AC2's
intent is to block runs whose baseline can't be verified, not to pass them. (Snapshots are
populated at publish time by `mapping_service.py`, so this arises for legacy versions
published before snapshots existed, or data manually cleared.)

## Fix

When the pinned version has no non-empty `schema_snapshot["source"]`, raise
`HTTPException(422, "pinned mapping version has no source schema snapshot; re-publish the
mapping to establish a drift baseline")` instead of returning `has_drift=false`. Task #3's
executor must treat this the same as drift: block the run.

## Verify

`backend/tests/pipelines/test_drift_validation.py`: version with `schema_snapshot=None` and
with `schema_snapshot={"source": {}}` → 422; audit trail not asserted for the 422 path (no
check was performed).

## Risk

Low. Behavior change is fail-closed, which is the only defensible direction for a gate whose
job is blocking silent data corruption.
