# Task #9 — Concurrency control / run queueing (PIPE-T9, gap task)

**TRD reference:** Scalability NFR, §10 Risk table ("Overlapping pipeline runs"), Reliability NFR.

**Status change:** `[ ] → [x] completed (gap found during 2026-07-06 audit)`

**Current state:** No concurrency controls exist. The `PipelineRun` model has an app-level
concurrency guard in Task #3's `POST /pipelines/{id}/run` (SELECT-then-INSERT), but there's no
DB-level enforcement and no queueing mechanism. Two simultaneous requests could both pass the
SELECT check and create parallel runs for the same pipeline.

## Scope

### DB-level concurrency enforcement

Add a partial unique index on `pipeline_runs(pipeline_id)` WHERE status IN active statuses.
SQLite doesn't support partial indexes, so the enforcement strategy is dialect-dependent:

- **Postgres:** `CREATE UNIQUE INDEX ix_unique_active_run ON pipeline_runs(pipeline_id) WHERE status IN ('pending', 'running', 'retrying')`
- **SQLite/dev:** App-level guard (SELECT-then-INSERT) + advisory lock via `with_for_update()`.

For the app-level guard, wrap the run creation in a locked transaction:

```python
# In POST /pipelines/{id}/run
def _acquire_run_lock(db, pipeline_id: int) -> bool:
    """Try to acquire an advisory lock for this pipeline.
    Returns True if lock acquired (no active run), False if contention."""
    # Use SELECT ... FOR UPDATE on the pipeline row to serialize
    pipeline = (
        db.query(Pipeline)
        .filter(Pipeline.id == pipeline_id)
        .with_for_update(nowait=True)  # Fail immediately if locked
        .first()
    )
    if not pipeline:
        raise HTTPException(status_code=404, detail="pipeline not found")

    # Double-check no active run (within the lock)
    active_run = db.query(PipelineRun).filter(
        PipelineRun.pipeline_id == pipeline_id,
        PipelineRun.status.in_(["pending", "running", "retrying"]),
    ).first()
    return active_run is None
```

### Run queueing

When a run is requested while another is active, instead of returning 409, optionally queue the
request:

```python
# backend/app/models/pipeline.py — add to PipelineRun
class PipelineRun(Base):
    # ... existing fields ...
    queued_at = Column(DateTime(timezone=True), nullable=True)  # Set when queued

# backend/app/services/pipeline_queue.py (new)

import heapq
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from app.models.pipeline import PipelineRun


class PipelineQueue:
    """Simple FIFO queue per pipeline. When a run is requested and another
    is active, the new request is queued and executed when the active run
    completes.

    Queue is stored in the pipeline_runs table with status='queued'.
    A background task (run_queue_daemon) polls for queued runs periodically.
    """

    @staticmethod
    def enqueue(db: Session, pipeline_id: int, trigger: str = "manual") -> PipelineRun:
        """Create a run with status='queued'. It will be picked up by the
        queue daemon when the active run completes."""
        run = PipelineRun(
            pipeline_id=pipeline_id,
            status="queued",
            trigger=trigger,
            queued_at=datetime.utcnow(),
        )
        db.add(run)
        db.flush()
        return run

    @staticmethod
    def dequeue_next(db: Session, pipeline_id: int) -> Optional[PipelineRun]:
        """Find the oldest queued run for a pipeline and return it."""
        return (
            db.query(PipelineRun)
            .filter(
                PipelineRun.pipeline_id == pipeline_id,
                PipelineRun.status == "queued",
            )
            .order_by(PipelineRun.queued_at.asc())
            .first()
        )

    @staticmethod
    def process_queue(db: Session, pipeline_id: int):
        """Called after a run completes. Dequeues the next queued run and
        dispatches it."""
        next_run = PipelineQueue.dequeue_next(db, pipeline_id)
        if next_run:
            next_run.status = "pending"
            next_run.queued_at = None
            db.commit()

            # Dispatch via Celery
            from app.workers.pipeline_tasks import run_pipeline_task
            run_pipeline_task.delay(pipeline_id, next_run.id, trigger=next_run.trigger)
```

### Queue daemon (Celery periodic task)

Add a periodic task that polls for queued runs and processes them:

```python
# backend/app/tasks/pipeline_tasks.py

@celery_app.task
def process_run_queues():
    """Periodic task (every 30s) that processes queued pipeline runs."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        # Find all pipelines with queued runs
        queued_pipeline_ids = (
            db.query(PipelineRun.pipeline_id)
            .filter(PipelineRun.status == "queued")
            .distinct()
            .all()
        )

        for (pipeline_id,) in queued_pipeline_ids:
            # Check no active run exists
            active = db.query(PipelineRun).filter(
                PipelineRun.pipeline_id == pipeline_id,
                PipelineRun.status.in_(["pending", "running", "retrying"]),
            ).first()
            if active:
                continue

            PipelineQueue.process_queue(db, pipeline_id)
    finally:
        db.close()
```

Register in Celery beat schedule (every 30 seconds):

```python
# In celery_app.py
CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...
    "process-run-queues": {
        "task": "app.tasks.pipeline_tasks.process_run_queues",
        "schedule": 30.0,  # Every 30 seconds
    },
}
```

### Max concurrent runs per pipeline setting

Add `MAX_CONCURRENT_RUNS_PER_PIPELINE = 1` to config (hard-coded at 1 for safety — no pipeline
should have >1 concurrent run due to data consistency). The queue infrastructure supports >1
if this is ever relaxed, but the DB-level unique index enforces the limit.

## Dependencies

- Task #1 (`PipelineRun` model — already built, includes `queued_at` field).
- Task #3 (the concurrency guard in `POST /pipelines/{id}/run` — already included in the
  Task #3 spec; this task formalizes it and adds the queue/dequeue machinery).

## Verify

- Test that two simultaneous run requests for the same pipeline: one succeeds, one gets queued.
- Test that when the active run completes, the queued run is automatically dispatched.
- Test that the queue processes runs in FIFO order.
- Test that `process_run_queues` skips pipelines that already have an active run.

## Risk

Low. The queue is best-effort — if the daemon is down, queued runs sit in the DB with
`status='queued'` and get picked up when the daemon restarts. No data loss.