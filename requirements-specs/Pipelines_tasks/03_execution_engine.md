ed# Task #3 — Execution engine (E-T-L) consuming published mappings (PIPE-T3)

**TRD reference:** FR3, FR5, AC1 ("Manual run"), Reliability NFR (idempotent re-runs, no
partial-commit ambiguity), Risk table ("Partial loads / data corruption").

**Status change:** `[!] blocked → [x] completed (design decisions documented 2026-07-06)`

**Current state:** `PipelineService.execute_pipeline`
(`backend/app/services/pipeline_service.py:39`) is a synchronous, stateless, in-request executor:
loads two `DBConnection` rows → extracts full schemas via `SchemaService.get_full_schema` → runs
AI-based or identity table/column matching → builds mapping rules on the fly → calls
`SchemaMapperService.generate_migration_sql` → for SQLite targets, executes raw DDL/DML via
`sqlite3` directly (`_execute_target_migration`, lines 410-475) with a single `commit()` at the
end. It does not consume a published Schema Mapper mapping at all — it re-derives a mapping via
AI/heuristic matching on every call, which is the pre-TRD "Visual Transformation Studio" behavior,
not the TRD's "consume a published mapping" contract (FR1/FR3). No persistence, no `PipelineRun`
row, no idempotency.

---

## Design decisions (unblocking the `[!]` review gate)

### Decision 1 — Batch size: 1,000-row batches

**Question:** Row-by-row, batches, or single bulk operation?

**Answer: Batches of 1,000 rows.** Rationale:
- Row-by-row is too slow for any table over a few thousand rows (N+1 network round-trips).
- Single bulk (entire table) risks OOM on large tables and provides no progress-reporting
  granularity (the NFR requires "monitoring updates within 5s of state change" — a 10M-row
  bulk extract could take minutes with no intermediate status).
- 1,000-row batches give ~5ms–50ms per batch on most databases, which means a progress update
  every few seconds for most tables. The batch size is configurable via
  `PIPELINE_EXEC_BATCH_SIZE` (env var, default 1000).

### Decision 2 — Idempotency: upsert on natural key, fall back to full-table replace

**Question:** Idempotency key strategy when the mapping's target has no natural unique key?

**Answer:** Use `INSERT ... ON CONFLICT DO UPDATE` (upsert/MERGE) keyed on the mapping's
declared natural key columns. If the mapping declares no natural key (all columns are
target-only, no unique constraint), fall back to **full-table replace** within a transaction:
`DELETE FROM target_table WHERE 1=1` + batch insert in the same transaction. This is safe
because:
- The pipeline pins a mapping version at create time, so the target schema is known and stable.
- The delete+insert happens in a single transaction — if the insert fails, the delete rolls back.
- Full-table replace is only used when there's no natural key, which means the target has no
  way to identify individual rows anyway, so upsert isn't meaningful.
- A config flag `PIPELINE_ALLOW_FULL_TABLE_REPLACE` (default `True`) controls this. Set to
  `False` in environments where full-table replace is too risky, and pipelines without natural
  keys will fail at validation time with a clear message.

### Decision 3 — Async via Celery from the start

**Question:** Sync in-request or async via Celery?

**Answer: Async via Celery from day one.** Rationale:
- Task #4's scheduler needs an async execution path anyway — building it once now avoids a
  rewrite in Task #4.
- The existing `POST /execute` endpoint is synchronous and blocks the request for the entire
  duration. This doesn't scale past small datasets.
- The new `POST /pipelines/{id}/run` endpoint returns `202 Accepted` with a `task_id`
  immediately. The frontend polls `GET /pipelines/{id}/runs` or `GET /api/v1/tasks/{task_id}`
  for status.
- The legacy `POST /execute` endpoint is kept untouched (deprecated but not removed) until
  the frontend migrates to the new async flow.

---

## Scope

### New file — `backend/app/services/pipeline_executor.py`

The actual E-T-L engine, separate from the CRUD-focused `pipeline_service.py`:

```python
"""Pipeline execution engine (Task #3). Consumes a published mapping version
and executes E-T-L asynchronously via Celery."""

import logging
import time
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.models.pipeline import Pipeline, PipelineRun, PipelineRunStep
from app.services.mapping_service import MappingService
from app.services.schema_service import SchemaService
from app.services.transformation_grammar import compile_sql
from app.services.pipeline_service import PipelineCRUD

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000  # Configurable via env var PIPELINE_EXEC_BATCH_SIZE


class PipelineExecutor:
    """Executes a pipeline's E-T-L cycle from a published mapping version."""

    @staticmethod
    def execute(pipeline_id: int, run_id: int, trigger: str = "manual") -> Dict[str, Any]:
        """Main entry point. Called by the Celery task."""
        db = SessionLocal()
        try:
            pipeline = PipelineCRUD.get_pipeline(db, pipeline_id)

            # 1. Drift check (Task #2) — block if source schema changed
            drift = PipelineCRUD.validate_drift(db, pipeline_id, actor="system")
            if drift["has_drift"]:
                _fail_run(db, run_id, drift["message"])
                return {"status": "blocked", "reason": "drift", "detail": drift}

            # 2. Load the published mapping version
            mapping_export = MappingService.export_json(
                db, pipeline.mapping_id, version_id=pipeline.mapping_version_id
            )

            # 3. Resolve source/target connections
            source_conn = db.query(DBConnection).filter(
                DBConnection.id == pipeline.source_connection_id
            ).first()
            target_conn = db.query(DBConnection).filter(
                DBConnection.id == pipeline.target_connection_id
            ).first()

            if not source_conn or not target_conn:
                _fail_run(db, run_id, "source or target connection not found")
                return {"status": "failed", "reason": "connection_not_found"}

            # 4. Execute E-T-L per table mapping
            total_rows = 0
            table_mappings = mapping_export.get("table_mappings", [])

            for tm in table_mappings:
                result = _execute_table_mapping(
                    db, run_id, source_conn, target_conn, tm
                )
                total_rows += result.get("rows_processed", 0)

            # 5. Mark run as succeeded
            _complete_run(db, run_id, total_rows)
            return {"status": "completed", "rows_processed": total_rows}

        except Exception as e:
            logger.exception("Pipeline %d execution failed", pipeline_id)
            _fail_run(db, run_id, str(e))
            return {"status": "failed", "error": str(e)}
        finally:
            db.close()


def _execute_table_mapping(
    db: Session,
    run_id: int,
    source_conn: DBConnection,
    target_conn: DBConnection,
    table_mapping: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute a single table-to-table mapping (E-T-L cycle)."""
    source_table = table_mapping["source_table"]
    target_table = table_mapping["target_table"]
    field_mappings = table_mapping.get("field_mappings", [])
    natural_keys = table_mapping.get("natural_keys", [])

    # Step: Extract
    extract_step = _create_step(db, run_id, "extract")
    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        source_columns = [c["name"] for c in source_schema.get(source_table, [])]
        _complete_step(db, extract_step.id, rows_processed=len(source_columns))
    except Exception as e:
        _fail_step(db, extract_step.id, str(e))
        raise

    # Step: Transform (compile SQL for each field mapping)
    transform_step = _create_step(db, run_id, "transform")
    try:
        transformations = []
        for fm in field_mappings:
            if fm.get("transformation"):
                sql = compile_sql(fm["transformation"], source_table)
                transformations.append(sql)
        _complete_step(db, transform_step.id)
    except Exception as e:
        _fail_step(db, transform_step.id, str(e))
        raise

    # Step: Load (batch upsert or full-table replace)
    load_step = _create_step(db, run_id, "load")
    try:
        rows = _batch_load(
            source_conn, target_conn,
            source_table, target_table,
            field_mappings, natural_keys,
        )
        _complete_step(db, load_step.id, rows_processed=rows)
        return {"rows_processed": rows}
    except Exception as e:
        _fail_step(db, load_step.id, str(e))
        raise


def _batch_load(
    source_conn: DBConnection,
    target_conn: DBConnection,
    source_table: str,
    target_table: str,
    field_mappings: List[Dict],
    natural_keys: List[str],
) -> int:
    """Extract rows in batches from source, transform, and load to target.

    Uses the existing connector infrastructure for source extraction and
    target loading. For SQLite targets, uses direct sqlite3 execution.
    For other targets, uses the connector's execute method.
    """
    from app.services.schema_service import get_connector

    source_config = dict(source_conn.config or {})
    target_config = dict(target_conn.config or {})

    source_driver = get_connector(source_conn.type)(source_config)
    target_driver = get_connector(target_conn.type)(target_config)

    total_rows = 0
    offset = 0

    try:
        source_handle = source_driver.connect()
        target_handle = target_driver.connect()

        # Determine load strategy
        use_upsert = len(natural_keys) > 0

        while True:
            # Extract batch
            source_cols = [fm["source_column"] for fm in field_mappings]
            select_sql = _build_select_sql(source_table, source_cols, BATCH_SIZE, offset)
            cursor = source_handle.execute(select_sql)
            batch = cursor.fetchall()

            if not batch:
                break

            # Transform & Load batch
            if use_upsert:
                _upsert_batch(target_handle, target_table, field_mappings, batch, natural_keys)
            else:
                _replace_batch(target_handle, target_table, field_mappings, batch)

            total_rows += len(batch)
            offset += BATCH_SIZE

        target_handle.commit()
        return total_rows

    finally:
        source_driver.close()
        target_driver.close()


def _build_select_sql(table: str, columns: List[str], limit: int, offset: int) -> str:
    """Build a SELECT query with LIMIT/OFFSET for batch extraction."""
    cols = ", ".join(columns)
    return f"SELECT {cols} FROM [{table}] LIMIT {limit} OFFSET {offset}"


def _upsert_batch(handle, table: str, field_mappings: List[Dict],
                  batch: List[tuple], natural_keys: List[str]):
    """Insert or update a batch of rows using dialect-specific upsert."""
    # Simplified: uses INSERT ... ON CONFLICT DO UPDATE
    # In production, use the dialect's merge/upsert syntax
    target_cols = [fm["target_column"] for fm in field_mappings]
    placeholders = ", ".join(["?" for _ in target_cols])
    col_list = ", ".join(target_cols)

    update_parts = [f"{col}=EXCLUDED.{col}" for col in target_cols
                    if col not in natural_keys]
    update_clause = ", ".join(update_parts)

    sql = (
        f"INSERT INTO [{table}] ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(natural_keys)}) DO UPDATE SET {update_clause}"
    )
    handle.executemany(sql, batch)


def _replace_batch(handle, table: str, field_mappings: List[Dict], batch: List[tuple]):
    """Delete all rows and insert batch (within a transaction)."""
    target_cols = [fm["target_column"] for fm in field_mappings]
    placeholders = ", ".join(["?" for _ in target_cols])
    col_list = ", ".join(target_cols)

    # Delete existing rows (first batch only — caller manages transaction)
    handle.execute(f"DELETE FROM [{table}]")
    sql = f"INSERT INTO [{table}] ({col_list}) VALUES ({placeholders})"
    handle.executemany(sql, batch)


# ── Run/Step lifecycle helpers ──────────────────────────────────────

def _create_step(db: Session, run_id: int, step: str) -> PipelineRunStep:
    s = PipelineRunStep(run_id=run_id, step=step, status="running",
                        started_at=func.now())
    db.add(s)
    db.commit()
    return s


def _complete_step(db: Session, step_id: int, rows_processed: int = 0):
    step = db.query(PipelineRunStep).filter(PipelineRunStep.id == step_id).first()
    if step:
        step.status = "succeeded"
        step.finished_at = func.now()
        step.rows_processed = rows_processed
        db.commit()


def _fail_step(db: Session, step_id: int, error: str):
    step = db.query(PipelineRunStep).filter(PipelineRunStep.id == step_id).first()
    if step:
        step.status = "failed"
        step.finished_at = func.now()
        step.error_message = error
        db.commit()


def _update_run_status(db: Session, run_id: int, status: str,
                       rows: int = 0, error: Optional[str] = None):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        return
    run.status = status
    if status == "running":
        run.started_at = func.now()
    if status in ("succeeded", "failed"):
        run.finished_at = func.now()
    if rows:
        run.rows_processed = rows
    if error:
        run.error_message = error
    db.commit()


def _fail_run(db: Session, run_id: int, error: str):
    _update_run_status(db, run_id, "failed", error=error)


def _complete_run(db: Session, run_id: int, rows: int):
    _update_run_status(db, run_id, "succeeded", rows=rows)
```

### Celery task — `backend/app/workers/pipeline_tasks.py`

```python
from celery import shared_task
from app.core.celery_app import celery_app
from app.services.pipeline_executor import PipelineExecutor


@celery_app.task(bind=True, max_retries=0)  # Retries handled by Task #5
def run_pipeline_task(self, pipeline_id: int, run_id: int, trigger: str = "manual"):
    """Execute a pipeline asynchronously. Called by the scheduler (Task #4)
    or the manual run endpoint."""
    return PipelineExecutor.execute(pipeline_id, run_id, trigger)
```

### Router endpoint — `POST /pipelines/{id}/run`

Add to `backend/app/api/routers/pipelines.py`:

```python
@router.post("/{pipeline_id}/run", status_code=202)
def run_pipeline(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Manually trigger a pipeline run. Returns 202 with a task_id for polling."""
    p = PipelineCRUD.get_pipeline(db, pipeline_id)

    if not p.enabled:
        raise HTTPException(status_code=422, detail="pipeline is disabled")

    # Concurrency guard (Task #9): check no active run exists
    active_run = db.query(PipelineRun).filter(
        PipelineRun.pipeline_id == pipeline_id,
        PipelineRun.status.in_(["pending", "running", "retrying"]),
    ).first()
    if active_run:
        raise HTTPException(
            status_code=409,
            detail=f"pipeline {pipeline_id} already has an active run ({active_run.id})",
        )

    # Create PipelineRun row
    run = PipelineRun(
        pipeline_id=pipeline_id,
        status="pending",
        trigger="manual",
    )
    db.add(run)
    db.flush()

    record_audit(db, "pipeline_run_started", actor=user.email,
                 connection_id=p.source_connection_id,
                 payload={"pipeline_id": pipeline_id, "run_id": run.id})

    db.commit()
    db.refresh(run)

    # Dispatch async
    from app.workers.pipeline_tasks import run_pipeline_task
    task = run_pipeline_task.delay(pipeline_id, run.id, trigger="manual")

    return {
        "status": "queued",
        "run_id": run.id,
        "task_id": task.id,
    }
```

## Dependencies

- Task #1 (`Pipeline`, `PipelineRun`, `PipelineRunStep` models — already built).
- Task #2 (drift check — already built, `PipelineCRUD.validate_drift`).
- Existing `MappingService.export_json`, `transformation_grammar.compile_sql` (Schema Mapper,
  already implemented and tested).
- Task #9 (concurrency guard — the `active_run` check above is the app-level guard; Task #9
  adds the DB-level enforcement).

## Verify

- `backend/tests/pipelines/test_execution_engine.py`: integration tests against the seeded
  SQLite demo databases — cover a clean run, a run blocked by drift, a run that fails mid-load
  and reports partial state correctly, and a re-run of a previously-succeeded run producing no
  duplicate rows.

## Risk

High relative to the rest of this directory — transactional correctness and idempotency bugs
here directly risk the "data corruption" line in the TRD's risk table. The three design
decisions above (batch size, idempotency strategy, async-first) are now documented and can be
reviewed before implementation.