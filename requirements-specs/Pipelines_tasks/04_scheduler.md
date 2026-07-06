# Task #4 — Scheduler (cron) (PIPE-T4)

**TRD reference:** FR4, AC3 ("Scheduled run"), Performance NFR ("Scheduler triggers within ±30s
of scheduled time").

**Status change:** `[ ] → [x] completed (design decisions from Task #3 resolved)`

**Current state:** Celery + `celery_app.conf.beat_schedule` already exist and work
(`backend/app/core/celery_app.py:29-33`), but the only registered entry is
`check-schema-drift` for Schema Mapper. Nothing schedules pipeline runs. No
`backend/app/workers/pipeline_tasks.py` exists.

**Precondition:** Task #3's Decision 3 (async via Celery) is resolved. The `run_pipeline_task`
Celery task exists in `backend/app/workers/pipeline_tasks.py`.

## Scope

### Celery task — `backend/app/workers/pipeline_tasks.py`

```python
from celery import shared_task
from app.core.celery_app import celery_app
from app.services.pipeline_executor import PipelineExecutor


@celery_app.task(bind=True, max_retries=0)  # Retries handled by Task #5
def run_pipeline_task(self, pipeline_id: int, run_id: int, trigger: str = "manual"):
    """Execute a pipeline asynchronously. Called by the scheduler or the
    manual run endpoint (POST /pipelines/{id}/run)."""
    return PipelineExecutor.execute(pipeline_id, run_id, trigger)
```

### Dynamic schedule registration

Rather than a static `beat_schedule` dict (which only supports schedules known at process-start),
add entries dynamically from the `Schedule` table. Use a `setup_schedule_tasks()` function called
from the FastAPI lifespan and re-synced whenever a `Schedule` row is created/updated/enabled/disabled.

```python
# backend/app/core/scheduler.py (new)

import logging
from typing import Dict
from celery import current_app
from celery.schedules import crontab
from croniter import croniter  # Use a battle-tested cron parser

logger = logging.getLogger(__name__)


def parse_cron_to_crontab(cron_expression: str) -> crontab:
    """Parse a standard 5-field cron expression into Celery's crontab kwargs.

    Supports: minute hour day_of_month month day_of_week
    Does NOT support @yearly/@monthly/etc. shortcuts (expand them first).
    """
    if not croniter.is_valid(cron_expression):
        raise ValueError(f"Invalid cron expression: {cron_expression}")

    parts = cron_expression.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Expected 5-field cron expression, got {len(parts)}: {cron_expression}")

    return crontab(
        minute=parts[0],
        hour=parts[1],
        day_of_month=parts[2],
        month_of_year=parts[3],
        day_of_week=parts[4],
    )


def setup_schedule_tasks():
    """Load all enabled schedules from the DB and register them with Celery beat."""
    from app.core.database import SessionLocal
    from app.models.pipeline import Schedule

    db = SessionLocal()
    try:
        schedules = db.query(Schedule).filter(Schedule.enabled == 1).all()
        beat_schedule = {}

        for s in schedules:
            task_name = f"run-pipeline-{s.pipeline_id}"
            try:
                beat_schedule[task_name] = {
                    "task": "app.workers.pipeline_tasks.run_pipeline_task",
                    "schedule": parse_cron_to_crontab(s.cron_expression),
                    "args": (s.pipeline_id,),
                    "kwargs": {"trigger": "scheduled"},
                    "options": {"timezone": s.timezone or "UTC"},
                }
            except ValueError as e:
                logger.warning("Invalid cron expression for schedule %d: %s", s.id, e)
                continue

        current_app.conf.beat_schedule = {
            **current_app.conf.beat_schedule,
            **beat_schedule,
        }
        logger.info("Registered %d pipeline schedules with Celery beat", len(beat_schedule))
    finally:
        db.close()


def sync_schedule(pipeline_id: int):
    """Re-sync a single pipeline's schedule after create/update/delete.

    Called by the PUT /pipelines/{id}/schedule endpoint.
    """
    # Remove existing entry for this pipeline
    keys_to_remove = [k for k in current_app.conf.beat_schedule
                      if k == f"run-pipeline-{pipeline_id}"]
    for k in keys_to_remove:
        del current_app.conf.beat_schedule[k]

    # Re-add if enabled
    from app.core.database import SessionLocal
    from app.models.pipeline import Schedule

    db = SessionLocal()
    try:
        s = db.query(Schedule).filter(
            Schedule.pipeline_id == pipeline_id,
            Schedule.enabled == 1,
        ).first()
        if s:
            task_name = f"run-pipeline-{pipeline_id}"
            current_app.conf.beat_schedule[task_name] = {
                "task": "app.workers.pipeline_tasks.run_pipeline_task",
                "schedule": parse_cron_to_crontab(s.cron_expression),
                "args": (pipeline_id,),
                "kwargs": {"trigger": "scheduled"},
                "options": {"timezone": s.timezone or "UTC"},
            }
            logger.info("Synced schedule for pipeline %d", pipeline_id)
    finally:
        db.close()
```

### FastAPI lifespan integration

In `backend/app/main.py`, call `setup_schedule_tasks()` during startup:

```python
from app.core.scheduler import setup_schedule_tasks

# In the lifespan context manager:
@asynccontextmanager
async def lifespan(app):
    # ... existing startup logic ...
    setup_schedule_tasks()
    yield
    # ... shutdown logic ...
```

### Router endpoints — add to `backend/app/api/routers/pipelines.py`

```python
@router.put("/{pipeline_id}/schedule", response_model=ScheduleRead)
def upsert_schedule(
    pipeline_id: int,
    req: ScheduleUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Create or update a pipeline's schedule. Re-syncs Celery beat."""
    p = PipelineCRUD.get_pipeline(db, pipeline_id)

    # Validate cron expression
    if not croniter.is_valid(req.cron_expression):
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {req.cron_expression}")

    # Upsert schedule row
    schedule = db.query(Schedule).filter(Schedule.pipeline_id == pipeline_id).first()
    if schedule:
        schedule.cron_expression = req.cron_expression
        schedule.enabled = 1 if req.enabled else 0
        schedule.timezone = req.timezone
    else:
        schedule = Schedule(
            pipeline_id=pipeline_id,
            cron_expression=req.cron_expression,
            enabled=1 if req.enabled else 0,
            timezone=req.timezone,
        )
        db.add(schedule)

    db.flush()
    record_audit(db, "pipeline_schedule_updated", actor=user.email,
                 connection_id=p.source_connection_id,
                 payload={"pipeline_id": pipeline_id, "cron": req.cron_expression,
                          "enabled": req.enabled})
    db.commit()
    db.refresh(schedule)

    # Re-sync Celery beat
    sync_schedule(pipeline_id)

    return schedule


@router.delete("/{pipeline_id}/schedule", status_code=204)
def delete_schedule(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Remove a pipeline's schedule."""
    schedule = db.query(Schedule).filter(Schedule.pipeline_id == pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="schedule not found")

    db.delete(schedule)
    record_audit(db, "pipeline_schedule_deleted", actor=user.email,
                 payload={"pipeline_id": pipeline_id})
    db.commit()

    # Remove from Celery beat
    sync_schedule(pipeline_id)
```

### Enable/disable schedule toggle

Add `PATCH /pipelines/{id}/schedule/toggle` for quick enable/disable without re-sending the
full cron expression:

```python
@router.patch("/{pipeline_id}/schedule/toggle", response_model=ScheduleRead)
def toggle_schedule(
    pipeline_id: int,
    enabled: bool = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Enable or disable a pipeline's schedule without changing the cron expression."""
    schedule = db.query(Schedule).filter(Schedule.pipeline_id == pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="schedule not found")

    schedule.enabled = 1 if enabled else 0
    record_audit(db, "pipeline_schedule_toggled", actor=user.email,
                 payload={"pipeline_id": pipeline_id, "enabled": enabled})
    db.commit()
    db.refresh(schedule)

    sync_schedule(pipeline_id)
    return schedule
```

### Next run time tracking

The scheduler should update `Schedule.next_run_at` after each scheduled run. Add this to the
`run_pipeline_task` completion path:

```python
# In run_pipeline_task, after successful execution:
from app.core.database import SessionLocal
from app.models.pipeline import Schedule
from croniter import croniter
from datetime import datetime

db = SessionLocal()
try:
    schedule = db.query(Schedule).filter(Schedule.pipeline_id == pipeline_id).first()
    if schedule:
        cron = croniter(schedule.cron_expression, datetime.utcnow())
        schedule.next_run_at = cron.get_next(datetime)
        db.commit()
finally:
    db.close()
```

## Dependencies

- Task #1 (`Schedule` model — already built).
- Task #3 (`run_pipeline_task` Celery task — design decisions resolved, task spec updated).

## Verify

- `backend/tests/pipelines/test_scheduler.py`: cron expression → correct `crontab(...)` kwargs
  (unit-level, no need to wait for real time to pass); enabling/disabling a schedule
  adds/removes the beat entry; a scheduled run creates a `PipelineRun` with `trigger="scheduled"`.
- Manual verification of the ±30s NFR requires running Celery beat for real over a short window —
  call this out as a manual QA step, not something the automated suite can assert deterministically.

## Risk

Medium — cron-expression edge cases (e.g. `*/5` step values, day-of-week vs. day-of-month
combinations, timezone handling for `Schedule.timezone`) are easy to get subtly wrong. The
`croniter` library handles these correctly — do not hand-roll the cron-string → `crontab()`
translation. Add `croniter` to `backend/requirements.txt`.