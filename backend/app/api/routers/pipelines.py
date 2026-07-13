"""Pipelines router — CRUD surface for the persistent Pipeline / PipelineRun
models added in Task #1.

The legacy `POST /execute` endpoint stays untouched (Task #3 will replace
the stateless synchronous executor with one that consumes a published
mapping version). All new CRUD endpoints mirror the pattern established
by the Schema Mapper upgrade (app/api/routers/mappings.py): role-gated,
audit-emitting, optimistic-payload-shaped responses.
"""
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Any, Dict

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.pipeline import (
    DriftValidationRead,
    PipelineCreate,
    PipelineRead,
    PipelineReadWithRelations,
    PipelineUpdate,
    PipelineRunRead,
    PipelineRunReadWithSteps,
    RetryPolicyRead,
    RetryPolicyUpsert,
    ScheduleRead,
    ScheduleUpsert,
)
from app.services.audit_helper import record_audit
from app.services.pipeline_service import PipelineCRUD, PipelineService


router = APIRouter()


# ── Legacy synchronous graph executor (kept until Task #3 replaces it) ──

class NodeConfig(BaseModel):
    connection_id: int | None = None


class PipelineNode(BaseModel):
    id: str
    type: str
    config: NodeConfig | None = None
    position: Dict[str, float] | None = None


class PipelineEdge(BaseModel):
    id: str
    source: str
    target: str


class ExecutePipelineRequest(BaseModel):
    nodes: List[PipelineNode]
    edges: List[PipelineEdge]


@router.post("/execute")
def execute_pipeline(req: ExecutePipelineRequest, db: Session = Depends(get_db)):
    """Legacy stateless executor. Task #3 will replace this with an
    executor that consumes a published mapping version and persists a
    PipelineRun row."""
    start_ms = int(time.time() * 1000)
    try:
        result = PipelineService.execute_pipeline(
            nodes=[n.model_dump() for n in req.nodes],
            edges=[e.model_dump() for e in req.edges],
        )
        duration_ms = int(time.time() * 1000) - start_ms
        record_audit(db, "pipeline_run", status="success", duration_ms=duration_ms,
                     payload={
                         "source": result.get("source"),
                         "target": result.get("target"),
                         "table_mappings": len(result.get("table_mappings", [])),
                         "rows_copied": result.get("rows_copied", 0),
                     })
        return result
    except ValueError as e:
        record_audit(db, "pipeline_run", status="failure",
                     payload={"error": str(e)})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        record_audit(db, "pipeline_run", status="failure",
                     payload={"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")


# ── Task #1 CRUD surface ────────────────────────────────────────────
# Role gating (Task #8 is implemented incrementally here as each endpoint
# is added — same approach used by the Schema Mapper upgrade):
#   - viewer: read-only (GET endpoints)
#   - analyst: read + write + schedule + retry
#   - admin: all of the above + delete
# Publish/Run/Disable endpoints (POST /pipelines/{id}/run, etc.) land
# with Tasks #3 / #4 / #5 and will reuse the same pattern.

@router.post("/", response_model=PipelineReadWithRelations, status_code=201)
def create_pipeline(
    req: PipelineCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    p = PipelineCRUD.create_pipeline(
        db,
        name=req.name,
        source_connection_id=req.source_connection_id,
        target_connection_id=req.target_connection_id,
        mapping_id=req.mapping_id,
        actor=user.email,
    )
    return PipelineReadWithRelations(
        **PipelineRead.model_validate(p).model_dump(),
        schedule=ScheduleRead.model_validate(p.schedule) if p.schedule else None,
        retry_policy=RetryPolicyRead.model_validate(p.retry_policy) if p.retry_policy else None,
    )


@router.get("/")
def list_pipelines(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    items, total = PipelineCRUD.list_pipelines(db, limit=limit, offset=offset)
    return {
        "items": [PipelineRead.model_validate(p).model_dump() for p in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


@router.get("/{pipeline_id}", response_model=PipelineReadWithRelations)
def get_pipeline(
    pipeline_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    p = PipelineCRUD.get_pipeline(db, pipeline_id)
    return PipelineReadWithRelations(
        **PipelineRead.model_validate(p).model_dump(),
        schedule=ScheduleRead.model_validate(p.schedule) if p.schedule else None,
        retry_policy=RetryPolicyRead.model_validate(p.retry_policy) if p.retry_policy else None,
    )


@router.put("/{pipeline_id}", response_model=PipelineRead)
def update_pipeline(
    pipeline_id: int,
    req: PipelineUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    p = PipelineCRUD.update_pipeline(
        db, pipeline_id,
        name=req.name,
        enabled=req.enabled,
        actor=user.email,
    )
    return PipelineRead.model_validate(p)


@router.delete("/{pipeline_id}", status_code=204)
def delete_pipeline(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    PipelineCRUD.delete_pipeline(db, pipeline_id, actor=user.email)
    return None


@router.get("/{pipeline_id}/runs")
def list_runs(
    pipeline_id: int,
    status: Optional[str] = Query(None, pattern="^(pending|running|succeeded|failed|retrying)$"),
    trigger: Optional[str] = Query(None, pattern="^(manual|scheduled|rerun)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    items, total = PipelineCRUD.list_runs(
        db, pipeline_id, limit=limit, offset=offset, status=status, trigger=trigger,
    )
    return {
        "items": [PipelineRunReadWithSteps.model_validate(r).model_dump() for r in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


@router.get("/{pipeline_id}/runs/{run_id}", response_model=PipelineRunReadWithSteps)
def get_run(
    pipeline_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return PipelineCRUD.get_run(db, pipeline_id, run_id)


# ── Task #3: manual run, Task #9: concurrency guard ─────────────────────

@router.post("/{pipeline_id}/run", status_code=202)
def run_pipeline(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Manually trigger a pipeline run. Returns 202 with a task_id for
    polling GET /pipelines/{id}/runs/{run_id}."""
    run = PipelineCRUD.create_run(db, pipeline_id, trigger="manual", actor=user.email)

    from app.workers.pipeline_tasks import run_pipeline_task
    task = run_pipeline_task.delay(pipeline_id, run.id, trigger="manual")

    return {"status": "queued", "run_id": run.id, "task_id": task.id}


@router.post("/{pipeline_id}/runs/{run_id}/rerun", status_code=202)
def rerun_pipeline(
    pipeline_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Re-run a past pipeline run against the pipeline's pinned mapping
    version (same as the original run — FR8)."""
    PipelineCRUD.get_run(db, pipeline_id, run_id)  # 404 if the original run doesn't exist
    new_run = PipelineCRUD.create_run(
        db, pipeline_id, trigger="rerun", actor=user.email, parent_run_id=run_id,
    )

    from app.workers.pipeline_tasks import run_pipeline_task
    task = run_pipeline_task.delay(pipeline_id, new_run.id, trigger="rerun")

    return {
        "status": "queued", "original_run_id": run_id,
        "new_run_id": new_run.id, "task_id": task.id,
    }


# ── Task #4: schedule CRUD ───────────────────────────────────────────────

@router.put("/{pipeline_id}/schedule", response_model=ScheduleRead)
def upsert_schedule(
    pipeline_id: int,
    req: ScheduleUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    schedule = PipelineCRUD.upsert_schedule(
        db, pipeline_id,
        cron_expression=req.cron_expression, enabled=req.enabled,
        timezone=req.timezone, actor=user.email,
    )
    from app.core.scheduler import sync_schedule
    sync_schedule(pipeline_id)
    return schedule


@router.delete("/{pipeline_id}/schedule", status_code=204)
def delete_schedule(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    PipelineCRUD.delete_schedule(db, pipeline_id, actor=user.email)
    from app.core.scheduler import sync_schedule
    sync_schedule(pipeline_id)
    return None


@router.patch("/{pipeline_id}/schedule/toggle", response_model=ScheduleRead)
def toggle_schedule(
    pipeline_id: int,
    enabled: bool = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    schedule = PipelineCRUD.toggle_schedule(db, pipeline_id, enabled=enabled, actor=user.email)
    from app.core.scheduler import sync_schedule
    sync_schedule(pipeline_id)
    return schedule


# ── Task #5: retry policy CRUD ───────────────────────────────────────────

@router.put("/{pipeline_id}/retry-policy", response_model=RetryPolicyRead)
def upsert_retry_policy(
    pipeline_id: int,
    req: RetryPolicyUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    return PipelineCRUD.upsert_retry_policy(
        db, pipeline_id,
        max_attempts=req.max_attempts, backoff_seconds=req.backoff_seconds,
        retryable_error_patterns=req.retryable_error_patterns, actor=user.email,
    )


# ── Task #2: Drift validation (FR2 / AC2) ──────────────────────
# GET /pipelines/{id}/drift previews whether the source schema has drifted
# from the snapshot captured when the pinned mapping_version was published.
# Task #3's executor calls PipelineCRUD.validate_drift at run time and
# blocks the run when has_drift=True. This endpoint lets users preview
# the same check without committing to a run.

@router.get("/{pipeline_id}/drift", response_model=DriftValidationRead)
def get_drift(
    pipeline_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return PipelineCRUD.validate_drift(
        db, pipeline_id, actor=user.email,
    )
