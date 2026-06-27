import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from app.core.database import get_db
from app.models.audit import AuditLog
from app.schemas.audit import AuditEventResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/", response_model=List[AuditEventResponse])
def list_audit_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = Query(None),
    connection_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Paginated audit event log with optional filters."""
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if event_type:
        q = q.filter(AuditLog.event_type == event_type)
    if connection_id is not None:
        q = q.filter(AuditLog.connection_id == connection_id)
    if status:
        q = q.filter(AuditLog.status == status)
    return q.offset((page - 1) * page_size).limit(page_size).all()


@router.get("/summary")
def audit_summary(db: Session = Depends(get_db)):
    """Aggregate counts by event_type and status for the dashboard widget."""
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
def get_audit_event(id: int, db: Session = Depends(get_db)):
    """Single audit event with full payload."""
    event = db.query(AuditLog).filter(AuditLog.id == id).first()
    if not event:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Audit event not found")
    return event
