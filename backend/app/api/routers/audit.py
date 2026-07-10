import csv
import io
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.audit import AuditLog
from app.schemas.audit import (
    AuditEventBatchRequest,
    AuditEventBatchResponse,
    AuditEventCreate,
    AuditEventResponse,
    AuditFacets,
    AuditSearchResponse,
    IntegrityVerificationResult,
    RetentionStatus,
)
from app.services.audit_helper import emit_audit_event, verify_hash_chain

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Ingestion ─────────────────────────────────────────────────────────────


@router.post("/events", response_model=AuditEventBatchResponse)
def ingest_events(batch: AuditEventBatchRequest, db: Session = Depends(get_db)):
    """Batch ingestion of audit events (AUDIT-T2).

    Accepts up to 100 events per request. Each event is validated individually;
    invalid events are rejected without blocking the valid ones.
    """
    accepted = 0
    rejected = 0
    errors = []

    for event in batch.events:
        try:
            emit_audit_event(
                db=db,
                event_type=event.event_type,
                actor=event.actor,
                module=event.module,
                target_type=event.target_type,
                target_id=event.target_id,
                target_name=event.target_name,
                before=event.before,
                after=event.after,
                correlation_id=event.correlation_id,
                outcome=event.outcome,
                summary=event.summary,
                duration_ms=event.duration_ms,
                metadata=event.metadata,
                connection_id=event.connection_id,
                connection_name=event.connection_name,
                payload=event.payload,
                status=event.status,
            )
            accepted += 1
        except Exception as exc:
            rejected += 1
            errors.append({"event_type": event.event_type, "error": str(exc)})

    db.commit()

    return AuditEventBatchResponse(
        accepted=accepted,
        rejected=rejected,
        errors=errors,
    )


# ── Search / Filter ───────────────────────────────────────────────────────


@router.get("/events", response_model=AuditSearchResponse)
def search_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    actor: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    correlation_id: Optional[str] = Query(None),
    outcome: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
):
    """Search/filter audit events (AUDIT-T4).

    Supports filtering by actor, module, event_type, target, correlation_id,
    outcome, and date range. Full-text search on summary and event_type.
    """
    q = db.query(AuditLog)

    if actor:
        q = q.filter(AuditLog.actor == actor)
    if module:
        q = q.filter(AuditLog.module == module)
    if event_type:
        q = q.filter(AuditLog.event_type == event_type)
    if target_type:
        q = q.filter(AuditLog.target_type == target_type)
    if target_id:
        q = q.filter(AuditLog.target_id == target_id)
    if correlation_id:
        q = q.filter(AuditLog.correlation_id == correlation_id)
    if outcome:
        q = q.filter(AuditLog.outcome == outcome)
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            q = q.filter(AuditLog.created_at >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            q = q.filter(AuditLog.created_at <= dt_to)
        except ValueError:
            pass
    if search:
        search_term = f"%{search}%"
        q = q.filter(
            or_(
                AuditLog.summary.ilike(search_term),
                AuditLog.event_type.ilike(search_term),
                AuditLog.actor.ilike(search_term),
            )
        )

    # Total count before pagination
    total = q.count()

    # Sorting
    sort_col = getattr(AuditLog, sort_by, AuditLog.created_at)
    if sort_order == "asc":
        q = q.order_by(sort_col.asc())
    else:
        q = q.order_by(sort_col.desc())

    # Pagination
    offset = (page - 1) * page_size
    events = q.offset(offset).limit(page_size).all()

    # Compute facets
    facets = _compute_facets(db, actor, module, event_type, outcome)

    return AuditSearchResponse(
        events=[AuditEventResponse.model_validate(e) for e in events],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(offset + page_size) < total,
        facets=facets,
    )


@router.get("/events/facets")
def get_facets(
    db: Session = Depends(get_db),
):
    """Return faceted search aggregates (AUDIT-T4)."""
    return _compute_facets(db)


def _compute_facets(
    db: Session,
    actor_filter: Optional[str] = None,
    module_filter: Optional[str] = None,
    event_type_filter: Optional[str] = None,
    outcome_filter: Optional[str] = None,
) -> AuditFacets:
    """Compute faceted search aggregates."""
    # Module counts
    module_q = db.query(AuditLog.module, func.count(AuditLog.id))
    if actor_filter:
        module_q = module_q.filter(AuditLog.actor == actor_filter)
    module_q = module_q.filter(AuditLog.module.isnot(None))
    module_q = module_q.group_by(AuditLog.module).order_by(func.count(AuditLog.id).desc()).limit(20)
    modules = {row[0] or "unknown": row[1] for row in module_q.all()}

    # Event type counts
    type_q = db.query(AuditLog.event_type, func.count(AuditLog.id))
    if actor_filter:
        type_q = type_q.filter(AuditLog.actor == actor_filter)
    if module_filter:
        type_q = type_q.filter(AuditLog.module == module_filter)
    type_q = type_q.group_by(AuditLog.event_type).order_by(func.count(AuditLog.id).desc()).limit(50)
    event_types = {row[0]: row[1] for row in type_q.all()}

    # Outcome counts
    outcome_q = db.query(AuditLog.outcome, func.count(AuditLog.id))
    if actor_filter:
        outcome_q = outcome_q.filter(AuditLog.actor == actor_filter)
    if module_filter:
        outcome_q = outcome_q.filter(AuditLog.module == module_filter)
    if event_type_filter:
        outcome_q = outcome_q.filter(AuditLog.event_type == event_type_filter)
    outcome_q = outcome_q.group_by(AuditLog.outcome)
    outcomes = {row[0]: row[1] for row in outcome_q.all()}

    # Actor counts (top 20)
    actor_q = db.query(AuditLog.actor, func.count(AuditLog.id))
    if module_filter:
        actor_q = actor_q.filter(AuditLog.module == module_filter)
    actor_q = actor_q.group_by(AuditLog.actor).order_by(func.count(AuditLog.id).desc()).limit(20)
    actors = {row[0]: row[1] for row in actor_q.all()}

    # Date range
    date_q = db.query(
        func.min(AuditLog.created_at),
        func.max(AuditLog.created_at),
    )
    date_result = date_q.first()
    date_range = None
    if date_result and date_result[0] and date_result[1]:
        date_range = {
            "earliest": date_result[0].isoformat() if date_result[0] else None,
            "latest": date_result[1].isoformat() if date_result[1] else None,
        }

    return AuditFacets(
        modules=modules,
        event_types=event_types,
        outcomes=outcomes,
        actors=actors,
        date_range=date_range,
    )


# ── Single event ──────────────────────────────────────────────────────────


@router.get("/events/{event_id}", response_model=AuditEventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    """Get a single audit event by ID."""
    event = db.query(AuditLog).filter(AuditLog.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Audit event not found")
    return event


# ── Integrity verification (AUDIT-T3) ─────────────────────────────────────


@router.post("/verify", response_model=IntegrityVerificationResult)
def verify_integrity(db: Session = Depends(get_db)):
    """Verify the hash chain integrity of the audit log (AUDIT-T3).

    Walks the chain from the first event and recomputes hashes.
    Reports any tampered events or chain breaks.
    """
    result = verify_hash_chain(db)
    return IntegrityVerificationResult(**result)


# ── Export (AUDIT-T6) ─────────────────────────────────────────────────────


@router.get("/export")
def export_events(
    format: str = Query("csv", regex="^(csv|json)$"),
    actor: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    correlation_id: Optional[str] = Query(None),
    outcome: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Export filtered audit events as CSV or JSON (AUDIT-T6).

    Uses the same filter parameters as the search endpoint.
    """
    q = db.query(AuditLog)

    if actor:
        q = q.filter(AuditLog.actor == actor)
    if module:
        q = q.filter(AuditLog.module == module)
    if event_type:
        q = q.filter(AuditLog.event_type == event_type)
    if target_type:
        q = q.filter(AuditLog.target_type == target_type)
    if correlation_id:
        q = q.filter(AuditLog.correlation_id == correlation_id)
    if outcome:
        q = q.filter(AuditLog.outcome == outcome)
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            q = q.filter(AuditLog.created_at >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            q = q.filter(AuditLog.created_at <= dt_to)
        except ValueError:
            pass
    if search:
        search_term = f"%{search}%"
        q = q.filter(AuditLog.summary.ilike(search_term))

    q = q.order_by(AuditLog.created_at.desc()).limit(100000)  # Max export limit
    events = q.all()

    if format == "csv":
        return _export_csv(events)
    else:
        return _export_json(events)


def _export_csv(events: list) -> StreamingResponse:
    """Export events as CSV."""
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "id", "event_type", "actor", "module", "target_type", "target_id",
        "target_name", "correlation_id", "outcome", "summary",
        "duration_ms", "sequence", "created_at",
    ]
    writer.writerow(headers)

    for e in events:
        writer.writerow([
            e.id,
            e.event_type,
            e.actor,
            e.module or "",
            e.target_type or "",
            e.target_id or "",
            e.target_name or "",
            e.correlation_id or "",
            e.outcome,
            e.summary or "",
            e.duration_ms or "",
            e.sequence or "",
            e.created_at.isoformat() if e.created_at else "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_export.csv"},
    )


def _export_json(events: list) -> StreamingResponse:
    """Export events as newline-delimited JSON."""
    lines = []
    for e in events:
        data = {
            "id": e.id,
            "event_type": e.event_type,
            "actor": e.actor,
            "module": e.module,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "target_name": e.target_name,
            "correlation_id": e.correlation_id,
            "outcome": e.outcome,
            "summary": e.summary,
            "duration_ms": e.duration_ms,
            "sequence": e.sequence,
            "event_hash": e.event_hash,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        lines.append(json.dumps(data))

    return StreamingResponse(
        iter(["\n".join(lines)]),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": "attachment; filename=audit_export.jsonl"},
    )


# ── Retention status (AUDIT-T7) ───────────────────────────────────────────


@router.get("/retention-status", response_model=RetentionStatus)
def get_retention_status(db: Session = Depends(get_db)):
    """Get current retention policy status (AUDIT-T7)."""
    from app.core.config import settings

    retention_days = getattr(settings, "AUDIT_RETENTION_DAYS", 90)
    total = db.query(func.count(AuditLog.id)).scalar() or 0

    cutoff = datetime.utcnow()
    expired = (
        db.query(func.count(AuditLog.id))
        .filter(AuditLog.created_at < cutoff)
        .scalar() or 0
    )

    return RetentionStatus(
        retention_days=retention_days,
        total_events=total,
        events_in_retention_window=total - expired,
        events_expired=expired,
        next_cleanup_at=None,
    )


# ── Legacy backward compat endpoints ──────────────────────────────────────


@router.get("/", response_model=list[AuditEventResponse])
def list_audit_events_legacy(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = Query(None),
    connection_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Legacy paginated audit event list (backward compatible)."""
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if event_type:
        q = q.filter(AuditLog.event_type == event_type)
    if connection_id is not None:
        q = q.filter(AuditLog.connection_id == connection_id)
    if status:
        q = q.filter(AuditLog.status == status)
    events = q.offset((page - 1) * page_size).limit(page_size).all()
    return [AuditEventResponse.model_validate(e) for e in events]


@router.get("/summary")
def audit_summary_legacy(db: Session = Depends(get_db)):
    """Legacy aggregate summary (backward compatible)."""
    rows = (
        db.query(AuditLog.event_type, AuditLog.status, func.count(AuditLog.id))
        .group_by(AuditLog.event_type, AuditLog.status)
        .all()
    )
    total = db.query(func.count(AuditLog.id)).scalar() or 0
    by_type: dict = {}
    for event_type, status, count in rows:
        by_type.setdefault(event_type, {"total": 0, "success": 0, "failure": 0, "warning": 0})
        by_type[event_type]["total"] += count
        by_type[event_type][status] = by_type[event_type].get(status, 0) + count
    return {"total": total, "by_event_type": by_type}


@router.get("/{id}", response_model=AuditEventResponse)
def get_audit_event_legacy(id: int, db: Session = Depends(get_db)):
    """Legacy single event endpoint (backward compatible)."""
    event = db.query(AuditLog).filter(AuditLog.id == id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Audit event not found")
    return event