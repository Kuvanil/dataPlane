"""Schema Mapper — versioned, audited, role-gated mapping workspace API."""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.mapping import AISuggestion, FieldMapping, Mapping
from app.models.user import User
from app.schemas.mapping import (
    EdgeCreate, EdgeResponse, EdgeTransformationUpdate, MappingCreate,
    MappingListResponse, MappingResponse, MappingUpdate, PublishResponse, SourceRef,
    SuggestionAcceptRequest, SuggestionListResponse, SuggestionResponse, TargetRef,
    ValidationIssue, ValidationResponse,
)
from app.services.mapping_service import MappingService

logger = logging.getLogger(__name__)
router = APIRouter()


def _edge_response(edge: FieldMapping) -> EdgeResponse:
    return EdgeResponse(
        id=edge.id,
        mapping_id=edge.mapping_id,
        target=TargetRef(
            table=edge.target_table, column=edge.target_column,
            type=edge.target_type,
            nullable=(
                bool(edge.target_nullable)
                if edge.target_nullable is not None else None
            ),
            primary_key=bool(edge.target_is_pk),
        ),
        sources=[SourceRef(**s) for s in (edge.sources or [])],
        transformation=edge.transformation or {"kind": "direct"},
        origin=edge.origin,
        ai_confidence=edge.ai_confidence,
        audit=edge.audit or {},
        created_at=edge.created_at,
        updated_at=edge.updated_at,
    )


def _mapping_response(m: Mapping) -> MappingResponse:
    return MappingResponse(
        id=m.id,
        name=m.name,
        source_id=m.source_id,
        target_id=m.target_id,
        status=m.status,
        current_version_id=m.current_version_id,
        created_by=m.created_by,
        created_at=m.created_at,
        updated_at=m.updated_at,
        edges=[
            _edge_response(e) for e in (m.edges or []) if e.version_id is None
        ],
    )


@router.post("/", response_model=MappingResponse, status_code=201)
def create_mapping(
    req: MappingCreate, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    m = MappingService.create_mapping(
        db, source_id=req.source_id, target_id=req.target_id,
        name=req.name, actor=user.email,
    )
    return _mapping_response(m)


@router.get("/", response_model=MappingListResponse)
def list_mappings(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    # Review §11.8: paginate to support the NFR of ≥10,000 mappings per
    # tenant. Returns {items, total, limit, offset, has_more} instead of a
    # bare list so the frontend can render "Load more" / page indicators.
    items, total = MappingService.list_mappings(
        db, limit=limit, offset=offset,
    )
    return {
        "items": [_mapping_response(m) for m in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


@router.get("/{mapping_id}", response_model=MappingResponse)
def get_mapping(
    mapping_id: int, db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    m = MappingService.get_mapping(db, mapping_id)
    return _mapping_response(m)


@router.put("/{mapping_id}", response_model=MappingResponse)
def update_mapping(
    mapping_id: int, req: MappingUpdate, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    m = MappingService.update_mapping_meta(
        db, mapping_id, name=req.name, actor=user.email,
    )
    return _mapping_response(m)


@router.delete("/{mapping_id}", status_code=204)
def delete_mapping(
    mapping_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    MappingService.delete_mapping(db, mapping_id, actor=user.email)
    return None


@router.post("/{mapping_id}/edges", response_model=EdgeResponse, status_code=201)
def add_edge(
    mapping_id: int, req: EdgeCreate, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    edge = MappingService.add_edge(
        db, mapping_id,
        target=req.target.model_dump(exclude_none=True),
        sources=[s.model_dump(exclude_none=True) for s in req.sources],
        transformation=req.transformation,
        origin=req.origin,
        actor=user.email,
    )
    return _edge_response(edge)


@router.delete("/{mapping_id}/edges/{edge_id}", status_code=204)
def remove_edge(
    mapping_id: int, edge_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    MappingService.remove_edge(db, mapping_id, edge_id, actor=user.email)
    return None


@router.put(
    "/{mapping_id}/edges/{edge_id}/transformation",
    response_model=EdgeResponse,
)
def update_edge_transformation(
    mapping_id: int, edge_id: int,
    req: EdgeTransformationUpdate, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    edge = MappingService.update_edge_transformation(
        db, mapping_id, edge_id, req.transformation, actor=user.email,
    )
    return _edge_response(edge)


@router.post("/{mapping_id}/suggestions")
def request_suggestions(
    mapping_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    task_id = MappingService.request_suggestions(
        db, mapping_id, actor=user.email,
    )
    return {"task_id": task_id, "status": "PENDING", "mapping_id": mapping_id}


@router.get("/{mapping_id}/suggestions", response_model=SuggestionListResponse)
def list_suggestions(
    mapping_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    # Review §11.8: paginate. Verify the mapping exists (so 404 fires
    # cleanly when the id is wrong instead of returning an empty list).
    MappingService.get_mapping(db, mapping_id)
    base = db.query(AISuggestion).filter(AISuggestion.mapping_id == mapping_id)
    total = base.count()
    rows = (
        base.order_by(AISuggestion.confidence.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(rows)) < total,
    }


@router.post(
    "/{mapping_id}/suggestions/{suggestion_id}/accept",
    response_model=EdgeResponse,
)
def accept_suggestion(
    mapping_id: int, suggestion_id: int,
    req: SuggestionAcceptRequest, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    edge = MappingService.accept_suggestion(
        db, mapping_id, suggestion_id, req.transformation, actor=user.email,
    )
    return _edge_response(edge)


@router.post(
    "/{mapping_id}/suggestions/{suggestion_id}/reject",
    response_model=SuggestionResponse,
)
def reject_suggestion(
    mapping_id: int, suggestion_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    sug = MappingService.reject_suggestion(
        db, mapping_id, suggestion_id, actor=user.email,
    )
    return sug


@router.post("/{mapping_id}/validate", response_model=ValidationResponse)
def validate_mapping(
    mapping_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    summary = MappingService.validate(db, mapping_id, actor=user.email)
    return ValidationResponse(
        mapping_id=summary["mapping_id"],
        ok_count=summary["ok_count"],
        warning_count=summary["warning_count"],
        blocking_count=summary["blocking_count"],
        issues=[ValidationIssue(**i) for i in summary["issues"]],
    )


@router.post("/{mapping_id}/publish", response_model=PublishResponse)
def publish_mapping(
    mapping_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    v = MappingService.publish(db, mapping_id, actor=user.email)
    return PublishResponse(
        mapping_id=mapping_id,
        version_number=v.version_number,
        version_id=v.id,
        status=v.status,
        published_at=v.published_at,
        published_by=v.published_by,
    )


@router.get("/{mapping_id}/export")
def export_mapping(
    mapping_id: int,
    version_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    artifact = MappingService.export_json(
        db, mapping_id, actor=_user.email, version_id=version_id,
    )
    return artifact
