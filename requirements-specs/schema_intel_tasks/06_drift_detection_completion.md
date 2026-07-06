# Task #6 — Drift detection completion: column-level diffs + on-demand rescan (SI-T6)

**TRD reference:** FR6, AC3, §11 Data model (`DriftEvent`).

**Current state:** PARTIAL, and closer to done than any other task in this epic — the hard part
already works. `check_schema_drift_task` (`backend/app/tasks/ai_tasks.py:272-358`) runs on a
Celery beat schedule (`backend/app/core/celery_app.py:29-34`, interval via
`SCHEMA_DRIFT_INTERVAL_MINUTES`) for every connection: computes a SHA-256 hash of the full schema
(`ai_tasks.py:290-291`), compares against the latest `SchemaSnapshot`
(`backend/app/models/schema_snapshot.py`), and on mismatch calls
`DiffService.compare_schemas(latest.schema_json, schema)` (`ai_tasks.py:305`) — which **already
computes real column-level detail** per matched table via `DiffService.compare_tables`
(`backend/app/services/diff_service.py:5-40`: `missing_in_target`, `missing_in_source`,
`type_mismatches` per table). The bug: only a table-level summary
(`matched_tables` count, `missing_tables_in_target`, `missing_tables_in_source`) is written into
the persisted `AuditLog` payload (`ai_tasks.py:311-319`) — the column-level `table_diffs` that
`compare_schemas` already returns (`diff_service.py:54-63`) is computed and then **discarded**,
never persisted anywhere. `GET /api/v1/schema/{id}/drift-history`
(`backend/app/api/routers/schema.py:63-88`) makes this worse by only returning `id`, `schema_hash`,
`captured_at`, `table_count` per snapshot — not even whether drift occurred, let alone what
changed. There is also no on-demand re-scan trigger — drift checking only runs via the beat
schedule, not per-connection on request (FR6: "the user shall be able to trigger re-scan").

## Scope

### Model — extend `backend/app/models/schema_catalog.py` (Task #1) or a standalone `drift.py`

`DriftEvent` — `id`, `connection_id` (FK), `snapshot_id` (FK → `SchemaSnapshot`),
`previous_snapshot_id` (FK, nullable for the first-ever scan), `tables_added` (JSON list),
`tables_removed` (JSON list), `columns_added` (JSON list of `{table, column}`), `columns_removed`
(JSON list), `type_changes` (JSON list of `{table, column, old_type, new_type}`), `detected_at`.
This is the minimal normalized shape that lets the drift-history endpoint answer "what changed"
without the caller re-diffing two raw JSON blobs client-side.

### Task — `backend/app/tasks/ai_tasks.py`

In `check_schema_drift_task`, when `drift_detected`, also persist a `DriftEvent` row built from
`diff.get("table_diffs")` (already computed, currently thrown away) plus the table-level
added/removed lists already computed (`missing_tables_in_target`/`missing_tables_in_source`) —
this is populating a new model from data the function already has in hand, not new diff logic.

### Router — extend `backend/app/api/routers/schema.py`

- `POST /api/v1/schema/{id}/rescan` — triggers an on-demand drift check for one connection
  (extract the per-connection body of `check_schema_drift_task`'s loop into a shared function
  callable both from the Celery task and this new synchronous — or Celery-dispatched, if scan
  latency warrants it — endpoint, rather than duplicating the hash/snapshot/diff logic).
- Rewrite `GET /{id}/drift-history` to include each snapshot's associated `DriftEvent` (if any),
  so the response actually shows added/removed/changed columns per AC3, not just a hash.

## Dependencies

- Task #1 is *not* a hard dependency — this task can be implemented against the existing
  `SchemaSnapshot`/`AuditLog` models alone and doesn't need the new catalog tables. Recommended to
  do in parallel with #1 rather than sequenced after it (see INDEX.md execution order).

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/test_drift.py -v
```
- Seed a connection, snapshot it, add a column at the source (or mutate the seed), trigger
  `/rescan`, confirm the response/drift-history shows the new column under `columns_added` (this is
  AC3's literal scenario).
- Confirm `check_schema_drift_task`'s existing behavior (audit event, snapshot retention of last
  10) is unchanged by this task — it's additive, not a rewrite.

## Risk

Low. The expensive/risky part (correct column-level diffing) is already written and implicitly
tested by virtue of existing in production; this task exposes and persists data that's already
being computed, plus adds one new endpoint that reuses existing logic.
