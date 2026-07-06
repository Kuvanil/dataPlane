# Task #2 — Drift validation pre-run (PIPE-T2)

**TRD reference:** FR2, AC2 ("Drift block"), Risk table ("Schema drift causing silent failures").

**Current state:** No drift check exists anywhere in pipeline code. `MappingVersion.schema_snapshot`
(the field this check needs) already exists and is populated at mapping-publish time
(`backend/app/models/mapping.py:80`, `backend/app/services/mapping_service.py:448,548`), but
nothing in `pipeline_service.py` reads it.

**Dependency note carried over from the original planning doc:** Schema Intel (the module the
TRD's dependency table names for drift detection) does not exist yet as a separate service. Rather
than block this task on Schema Intel shipping, stub the check using data that already exists:
compare a freshly computed hash of the live source schema against the hash stored in
`MappingVersion.schema_snapshot` at the time the mapping (pinned via `Pipeline.mapping_version_id`,
Task #1) was published. This satisfies FR2's invariant — block runs when the source has drifted
— without a new cross-module dependency. Re-visit once Schema Intel ships to see if it should own
this comparison instead of Pipelines re-implementing it.

## Scope

- Add `compute_schema_hash(schema: dict) -> str` (or reuse if `SchemaService`/`mapping_service`
  already has an equivalent normalization+hash routine — check before writing a second one).
- In the pre-run path (called from both manual run and scheduled run, Task #3/#4), before
  extract begins: fetch the live source schema via the existing `SchemaService.get_full_schema`,
  hash it, and compare to `MappingVersion.schema_snapshot`'s stored hash for
  `Pipeline.mapping_version_id`.
- On mismatch: do not start the run. Return/record a clear `drift_detected` error
  (`PipelineRun.status = "failed"`, `error_message` naming the specific drifted
  tables/columns if cheaply derivable from a schema diff, otherwise a generic
  "source schema has changed since mapping was published" message) per AC2 — "blocked with a
  drift warning until the mapping is updated."
- On match: proceed to execution (Task #3).

## Dependencies

- Task #1 (`Pipeline.mapping_version_id` must exist to know which snapshot to compare against).
- Task #3 (this check is a precondition inside the execution entrypoint, not a standalone
  endpoint — no new API surface beyond what Task #3 already adds).

## Verify

- `backend/tests/pipelines/test_drift_validation.py`: unmodified schema → run proceeds; source
  schema with an added/removed/type-changed column → run blocked with `drift_detected`.

## Risk

Low-medium. The hash comparison itself is mechanical; the main judgment call is what counts as
"drift" (e.g. does adding a nullable column the mapping doesn't reference count? Recommend: no —
hash only the subset of source columns actually referenced by the mapping's `FieldMapping.sources`,
not the whole schema, so unrelated source-table changes don't spuriously block unrelated
pipelines). Flag this scoping decision for review if the naive "hash the whole schema" approach
turns out to cause too many false-positive blocks in practice.
