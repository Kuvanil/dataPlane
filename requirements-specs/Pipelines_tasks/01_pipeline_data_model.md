# Task #1 — Pipeline data model + persistence (PIPE-T1)

**TRD reference:** FR1, FR6, §11 Data model (`Pipeline`, `PipelineRun`, `Schedule`, `RunStep`, `RetryPolicy`), §12 DoD.

**Current state:** No `backend/app/models/pipeline.py` exists. There is no `Pipeline`, `PipelineRun`,
`PipelineRunStep`, `Schedule`, or `RetryPolicy` model anywhere in the codebase — confirmed by
`grep -rn "class Pipeline"` returning nothing. The only pipeline-adjacent code today is
`backend/app/services/pipeline_service.py`, a stateless synchronous graph executor with no
persistence (see Task #3 for detail). This task is the foundation everything else in this
directory depends on.

## Scope

Add SQLAlchemy models + Pydantic schemas + basic CRUD service/router, mirroring the pattern
already established for Schema Mapper (`backend/app/models/mapping.py`,
`backend/app/services/mapping_service.py`).

### Models — `backend/app/models/pipeline.py`

- `Pipeline` — `id`, `tenant_id`, `name`, `source_connection_id` (FK → `DBConnection`),
  `target_connection_id` (FK → `DBConnection`), `mapping_id` (FK → `Mapping`), `mapping_version_id`
  (FK → `MappingVersion`, pinned at create time so drift checks have a stable baseline —
  see Task #2), `enabled` (bool), `created_by`, `created_at`, `updated_at`.
- `Schedule` — `id`, `pipeline_id` (FK, one-to-one or one-to-many if multiple schedules per
  pipeline are ever needed — one-to-one is sufficient per TRD FR4), `cron_expression`,
  `enabled`, `timezone`, `next_run_at` (nullable, maintained by the scheduler — see Task #4).
- `RetryPolicy` — `id`, `pipeline_id` (FK), `max_attempts`, `backoff_seconds`,
  `retryable_error_patterns` (JSON list, optional — used by Task #5 to classify transient vs.
  terminal failures).
- `PipelineRun` — `id`, `pipeline_id` (FK), `status` (enum: `pending`, `running`, `succeeded`,
  `failed`, `retrying`), `trigger` (enum: `manual`, `scheduled`, `rerun`), `started_at`,
  `finished_at`, `rows_processed`, `error_message`, `retry_count`, `parent_run_id` (nullable
  self-FK, set when this run is a re-run of a past run — supports FR8).
- `PipelineRunStep` — `id`, `run_id` (FK), `step` (enum: `extract`, `transform`, `load`),
  `status`, `started_at`, `finished_at`, `rows_processed`, `error_message` — gives the run
  monitor (Task #7) step-level granularity, not just a single overall status.

### Schemas — `backend/app/schemas/pipeline.py`

Pydantic request/response models mirroring `backend/app/schemas/mapping.py`'s conventions:
`PipelineCreate`, `PipelineUpdate`, `PipelineRead`, `PipelineRunRead`, `PipelineRunStepRead`,
`ScheduleUpsert`, `RetryPolicyUpsert`.

### Service — `backend/app/services/pipeline_service.py`

Rename/refactor the existing file's CRUD-adjacent surface (the current `execute_pipeline` method
stays, untouched, until Task #3 replaces it). Add: `create_pipeline`, `get_pipeline`,
`list_pipelines`, `update_pipeline`, `delete_pipeline`, `list_runs`.

### Router — `backend/app/api/routers/pipelines.py`

Add CRUD endpoints alongside the existing `POST /execute`:
`POST /pipelines`, `GET /pipelines`, `GET /pipelines/{id}`, `PUT /pipelines/{id}`,
`DELETE /pipelines/{id}`, `GET /pipelines/{id}/runs`. Role gating and audit emission are handled
in Task #8, not here — land the plain CRUD first, then layer gating/audit on top, matching how
Schema Mapper's endpoints evolved.

## Dependencies

- Schema Mapper's `Mapping` / `MappingVersion` models (already exist — `backend/app/models/mapping.py`)
  for the `mapping_id` / `mapping_version_id` FKs.
- `DBConnection` model (already exists) for `source_connection_id` / `target_connection_id`.

## Verify

```bash
cd backend && .venv/bin/pytest tests/pipelines/ -v   # new test dir, see Task #10
```
- Confirm `Base.metadata.create_all` picks up the new tables (check via
  `sqlite3 <db> ".tables"` in a dev run, matching how Schema Mapper's tables were verified).

## Risk

Low — this is additive schema work with no existing pipeline persistence to migrate away from.
