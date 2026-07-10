"""Semantic / Metrics Layer router (DP-SEM-001).

Endpoints for the CRUD + versioning + catalog + (future) resolution
surface. Mirrors the role-gating pattern established by
backend/app/api/routers/mappings.py: viewer can read; analyst can
create/update drafts; admin can publish (gates the most consequential
state change) and archive.

Tasks covered by this router:
- #1 (SEM-T4): versioning + draft/published endpoints
- #2 (SEM-T9): audit emission (already embedded in the service layer)
- #6 (SEM-T5 partial): GET /semantic/catalog with search + certified filter

Tasks deferred:
- #3 (SEM-T1 full): definition language grammar + validator (next)
- #4 (SEM-T2): physical-schema mapping (uses lineage table already)
- #5 (SEM-T3): query resolution engine
- #7 (SEM-T6): metric editor UI
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.semantic import (
    SemanticDimension,
    SemanticEntity,
    SemanticMeasure,
    SemanticMetricDefinition,
)
from app.models.user import User
from app.schemas.semantic import (
    ResolutionRequest,
    ResolutionResponse,
    SemanticDimensionCreate,
    SemanticDimensionRead,
    SemanticEntityCreate,
    SemanticEntityRead,
    SemanticLineageCreate,
    SemanticLineageRead,
    SemanticMeasureCreate,
    SemanticMeasureRead,
    SemanticMetricCreate,
    SemanticMetricRead,
    SemanticMetricReadWithRelations,
    SemanticMetricUpdate,
    SemanticLineageRead,
)
from app.services.semantic_service import SemanticCRUD  # noqa: F401


logger = logging.getLogger(__name__)
router = APIRouter()


# ── Entities ────────────────────────────────────────────────────


@router.post("/entities", response_model=SemanticEntityRead, status_code=201)
def create_entity(
    req: SemanticEntityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    return SemanticCRUD.create_entity(
        db, name=req.name, description=req.description, owner=req.owner,
        actor=user.email,
    )


@router.get("/entities", response_model=List[SemanticEntityRead])
def list_entities(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return SemanticCRUD.list_entities(db)


# ── Dimensions + measures ───────────────────────────────────────


@router.post(
    "/dimensions", response_model=SemanticDimensionRead, status_code=201,
)
def create_dimension(
    req: SemanticDimensionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    return SemanticCRUD.create_dimension(
        db, entity_id=req.entity_id, name=req.name,
        semantic_type=req.semantic_type, description=req.description,
        catalog_column_id=req.catalog_column_id,
        actor=user.email,
    )


@router.post(
    "/measures", response_model=SemanticMeasureRead, status_code=201,
)
def create_measure(
    req: SemanticMeasureCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    return SemanticCRUD.create_measure(
        db, entity_id=req.entity_id, name=req.name,
        default_aggregation=req.default_aggregation,
        description=req.description,
        catalog_column_id=req.catalog_column_id,
        actor=user.email,
    )


# ── Metric definitions (SEM-T4 versioning) ─────────────────────


@router.post(
    "/metrics", response_model=SemanticMetricReadWithRelations, status_code=201,
)
def create_metric_draft(
    req: SemanticMetricCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    m = SemanticCRUD.create_metric_draft(
        db, name=req.name, definition=req.definition,
        description=req.description, certified=req.certified,
        owner=req.owner, actor=user.email,
    )
    return SemanticMetricReadWithRelations(
        **SemanticMetricRead.model_validate(m).model_dump(),
        lineage=[],
    )


@router.put("/metrics/{metric_id}", response_model=SemanticMetricRead)
def save_draft(
    metric_id: int,
    req: SemanticMetricUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    m = SemanticCRUD.save_draft(
        db, metric_id,
        definition=req.definition, description=req.description,
        certified=req.certified, owner=req.owner,
        actor=user.email,
    )
    return SemanticMetricRead.model_validate(m)


@router.post(
    "/metrics/{metric_id}/publish",
    response_model=SemanticMetricReadWithRelations,
)
def publish_metric(
    metric_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    """Publish the current draft as a new immutable version. Admin-only
    because publishing makes a definition visible to all consumers
    (Visualize, AskData Bot); analyst can save drafts but not publish."""
    published = SemanticCRUD.publish(db, metric_id, actor=user.email)
    return SemanticMetricReadWithRelations(
        **SemanticMetricRead.model_validate(published).model_dump(),
        lineage=[
            SemanticLineageRead.model_validate(ln).model_dump()
            for ln in (published.lineage or [])
        ],
    )


@router.post(
    "/metrics/{metric_id}/archive", response_model=SemanticMetricRead,
)
def archive_metric(
    metric_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    """Archive a metric version. Hidden from the catalog search but
    retained for history. Admin-only — same rationale as publish."""
    return SemanticCRUD.archive(db, metric_id, actor=user.email)


@router.get("/metrics/{metric_id}", response_model=SemanticMetricReadWithRelations)
def get_metric(
    metric_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    m = SemanticCRUD.get_metric(db, metric_id)
    return SemanticMetricReadWithRelations(
        **SemanticMetricRead.model_validate(m).model_dump(),
        lineage=[
            SemanticLineageRead.model_validate(ln).model_dump()
            for ln in (m.lineage or [])
        ],
    )


@router.get("/metrics", response_model=List[SemanticMetricRead])
def list_metrics(
    only_published: bool = Query(False, description="Hide drafts and archived"),
    only_certified: Optional[bool] = Query(
        None, description="Filter by certified badge (true/false/null=both)",
    ),
    search: Optional[str] = Query(None, description="Search name + description"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Metric catalog search (FR4 / SEM-T5).

    Default returns everything; production UIs typically set
    only_published=true to hide drafts. `search` is case-insensitive
    substring match against name OR description.
    """
    return SemanticCRUD.list_metrics(
        db, only_published=only_published, only_certified=only_certified,
        search=search,
    )


@router.get(
    "/metrics/by-name/{name}/versions",
    response_model=List[SemanticMetricRead],
)
def list_metric_versions(
    name: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return SemanticCRUD.list_metric_versions(db, name)


# ── Lineage ──────────────────────────────────────────────────


@router.post(
    "/lineage", response_model=SemanticLineageRead, status_code=201,
)
def add_lineage(
    req: SemanticLineageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    return SemanticCRUD.add_lineage(
        db, metric_id=req.metric_id,
        catalog_column_id=req.catalog_column_id, role=req.role,
        actor=user.email,
    )


# ── Task #5: Query resolution (SEM-T3) ──────────────────────────
# POST /semantic/resolve resolves a published metric version into a
# parameterized SQL query against the physical schema. Accepts caller
# dimensions + filters at query time (FR5).
#
# Drafts are rejected -- only published versions can be resolved
# (AC2 "consistent resolution"). The response contains the rendered
# SQL plus the placeholder list so callers can bind against their
# preferred driver.

@router.post("/resolve", response_model=ResolutionResponse)
def resolve_metric(
    req: ResolutionRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.semantic_resolver import (
        ResolutionError as _ResolutionError,
        resolve as _resolve,
    )
    try:
        sql, placeholders = _resolve(
            db, req.metric_id,
            dimensions=req.dimensions or None,
            filters=req.filters or None,
        )
    except _ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Surface the resolved artifact's name + version for the caller.
    m = (
        db.query(SemanticMetricDefinition)
        .filter(SemanticMetricDefinition.id == req.metric_id)
        .first()
    )
    return ResolutionResponse(
        metric_id=req.metric_id,
        metric_name=m.name if m else "",
        metric_version=m.version_number if m else 0,
        sql=sql,
        placeholders=placeholders,
        lineage=[],
    )
