"""Shared helper for writing audit log entries. Never raises."""
import logging
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session
from app.models.audit import AuditLog

logger = logging.getLogger(__name__)


def record_audit(
    db: Session,
    event_type: str,
    actor: str = "admin",
    connection_id: Optional[int] = None,
    connection_name: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    status: str = "success",
    duration_ms: Optional[int] = None,
) -> None:
    try:
        entry = AuditLog(
            event_type=event_type,
            actor=actor,
            connection_id=connection_id,
            connection_name=connection_name,
            payload=payload or {},
            status=status,
            duration_ms=duration_ms,
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        logger.warning("Failed to write audit log (%s): %s", event_type, exc)
        try:
            db.rollback()
        except Exception:
            pass
