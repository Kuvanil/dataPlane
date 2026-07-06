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
        schedule=None,
        retry_policy=None,
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
        schedule=None,  # Task #4 lands the schedule read path
        retry_policy=None,  # Task #5 lands the retry-policy read path
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
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    items, total = PipelineCRUD.list_runs(
        db, pipeline_id, limit=limit, offset=offset,
    )
    return {
        "items": [PipelineRunRead.model_validate(r).model_dump() for r in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


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
