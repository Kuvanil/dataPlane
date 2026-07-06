# Task #6 — Run history + re-run (PIPE-T6)

**TRD reference:** FR6, FR8, §12 DoD "Run history queryable."

**Status change:** `[ ] → [x] completed`

**Current state:** `PipelineCRUD.list_runs` and `PipelineCRUD.get_run` already exist
(`backend/app/services/pipeline_service.py:357-401`). The read path for run history is built.
What's missing: re-run (FR8) — there's no endpoint to trigger a new run against a past run's
configuration.

## Scope

### Re-run endpoint — `POST /pipelines/{id}/runs/{run_id}/rerun`

```python
@router.post("/{pipeline_id}/runs/{run_id}/rerun", status_code=202)
def rerun_pipeline(
    pipeline_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Re-run a past pipeline run. Creates a new PipelineRun that references
    the original run via parent_run_id."""
    p = PipelineCRUD.get_pipeline(db, pipeline_id)
    original_run = PipelineCRUD.get_run(db, pipeline_id, run_id)

    # Concurrency guard
    active_run = db.query(PipelineRun).filter(
        PipelineRun.pipeline_id == pipeline_id,
        PipelineRun.status.in_(["pending", "running", "retrying"]),
    ).first()
    if active_run:
        raise HTTPException(
            status_code=409,
            detail=f"pipeline {pipeline_id} already has an active run ({active_run.id})",
        )

    # Create new run linked to the original
    new_run = PipelineRun(
        pipeline_id=pipeline_id,
        status="pending",
        trigger="rerun",
        parent_run_id=run_id,  # Link to the original run (FR8)
    )
    db.add(new_run)
    db.flush()

    record_audit(db, "pipeline_rerun", actor=user.email,
                 connection_id=p.source_connection_id,
                 payload={
                     "pipeline_id": pipeline_id,
                     "original_run_id": run_id,
                     "new_run_id": new_run.id,
                 })

    db.commit()
    db.refresh(new_run)

    # Dispatch async (reuses the same pinned mapping_version_id)
    from app.workers.pipeline_tasks import run_pipeline_task
    task = run_pipeline_task.delay(pipeline_id, new_run.id, trigger="rerun")

    return {
        "status": "queued",
        "original_run_id": run_id,
        "new_run_id": new_run.id,
        "task_id": task.id,
    }
```

### Run history enhancements

The existing `GET /pipelines/{id}/runs` and `GET /pipelines/{id}/runs/{run_id}` endpoints already
work. Enhance them with:

1. **Filtering by status and trigger** — add query params to `list_runs`:

```python
@router.get("/{pipeline_id}/runs")
def list_runs(
    pipeline_id: int,
    status: Optional[str] = Query(None, regex="^(pending|running|succeeded|failed|retrying)$"),
    trigger: Optional[str] = Query(None, regex="^(manual|scheduled|rerun)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    items, total = PipelineCRUD.list_runs(
        db, pipeline_id, limit=limit, offset=offset,
        status=status, trigger=trigger,
    )
    return {
        "items": [PipelineRunReadWithSteps.model_validate(r).model_dump() for r in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }
```

2. **Step-level detail** — the existing `get_run` already embeds steps. Ensure the response
  uses `PipelineRunReadWithSteps` so the frontend can display per-step E-T-L status.

3. **Rerun lineage** — the `parent_run_id` field on the response lets the UI show:
   "Run #42 was re-run from Run #37."

### Update `PipelineCRUD.list_runs` to support filters

```python
@staticmethod
def list_runs(
    db: Session,
    pipeline_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    trigger: Optional[str] = None,
) -> tuple:
    PipelineCRUD.get_pipeline(db, pipeline_id)
    query = db.query(PipelineRun).filter(PipelineRun.pipeline_id == pipeline_id)

    if status:
        query = query.filter(PipelineRun.status == status)
    if trigger:
        query = query.filter(PipelineRun.trigger == trigger)

    total = query.count()
    items = query.order_by(PipelineRun.id.desc()).offset(offset).limit(limit).all()
    return items, total
```

### Re-run against pinned mapping version

A re-run uses the **same pinned `mapping_version_id`** that the pipeline was created with —
not the mapping's current published version. This is critical for consistency (FR8):
the re-run reproduces the same data movement as the original run, even if the mapping has
been updated since. The `PipelineExecutor` already loads `pipeline.mapping_version_id` at
execution time (from the pipeline row, which is stable), so this is the default behavior —
no change needed.

## Dependencies

- Task #1 (`PipelineRun.parent_run_id` — already built).
- Task #3 (execution engine — dispatches the new run).
- Task #9 (concurrency guard — shared with `POST /pipelines/{id}/run`).

## Verify

- Test that `POST /pipelines/{id}/runs/{run_id}/rerun` creates a new run with
  `trigger='rerun'` and `parent_run_id` set.
- Test that the new run executes (via the same Celery path as a manual run).
- Test that the original run's history is unchanged.
- Test that re-run is blocked if the pipeline already has an active run (409).
- Test that filtering `GET /runs` by status and trigger works correctly.

## Risk

Low. The re-run path reuses the existing execution engine — no new data movement logic.
The `parent_run_id` link is purely informational (for UI lineage display). The pinned
mapping version behavior is the default, not a special case.