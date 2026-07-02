"""Shared helper for writing audit log entries.

Contract (review §11.6):
    record_audit() does NOT call db.commit() or db.rollback() on the
    caller's session. It stages the row inside a SAVEPOINT so that an
    audit-write failure rolls back only the audit insert, never the
    caller's pending business work. The CALLER owns the outer
    transaction boundary.

    Rationale: the previous implementation called db.commit() and
    db.rollback() on the caller's session, which broke transactional
    atomicity in two ways:
      1. Silent data loss on audit-write failure -- caller's already-
         flushed business object was discarded by record_audit's
         except-branch rollback.
      2. Non-atomic multi-step operations -- accept_suggestion could
         persist a partial state if record_audit's commit succeeded but
         a subsequent step crashed before the caller's commit.

    Using a SAVEPOINT via db.begin_nested() means:
      - Successful audit insert: the row is staged in the caller's
        session; the caller's commit() persists it atomically with the
        business work.
      - Failed audit insert: the SAVEPOINT is rolled back; the caller's
        session remains valid (no connection-invalidated error); the
        caller's subsequent commit() proceeds with just the business
        work.

    If audit durability becomes a hard requirement independent of the
    business transaction, switch to an outbox pattern (separate session).
    Out of scope for this fix.
"""
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
        # SAVEPOINT isolates the audit insert from the caller's
        # transaction. On exception, only the savepoint is rolled back;
        # the caller's session stays valid.
        with db.begin_nested():
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
    except Exception as exc:
        # Log and swallow -- a missing audit row is preferable to a
        # half-committed business object. The caller's commit() will
        # proceed without the audit row.
        logger.warning("Failed to write audit log (%s): %s", event_type, exc)
