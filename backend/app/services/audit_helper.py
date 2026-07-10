"""Shared helper for writing audit log entries.

Contract (review §11.6):
    emit_audit_event() does NOT call db.commit() or db.rollback() on the
    caller's session. It stages the row inside a SAVEPOINT so that an
    audit-write failure rolls back only the audit insert, never the
    caller's pending business work. The CALLER owns the outer
    transaction boundary.

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
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.audit import AuditLog

logger = logging.getLogger(__name__)


def emit_audit_event(
    db: Session,
    event_type: str,
    actor: str = "system",
    module: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[Any] = None,
    target_name: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    correlation_id: Optional[str] = None,
    outcome: str = "success",
    summary: Optional[str] = None,
    duration_ms: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
    # Legacy parameters (backward compat)
    connection_id: Optional[int] = None,
    connection_name: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    status: str = "success",
) -> str:
    """Emit a canonical audit event.

    Returns the correlation_id (auto-generated if not provided).
    All modules should use this function instead of directly creating AuditLog rows.
    """
    if correlation_id is None:
        correlation_id = str(uuid.uuid4())

    # Convert target_id to string for storage
    target_id_str = str(target_id) if target_id is not None else None

    try:
        with db.begin_nested():
            entry = AuditLog(
                event_type=event_type,
                actor=actor,
                module=module,
                target_type=target_type,
                target_id=target_id_str,
                target_name=target_name,
                before_summary=before,
                after_summary=after,
                correlation_id=correlation_id,
                outcome=outcome,
                summary=summary,
                duration_ms=duration_ms,
                metadata=metadata,
                # Legacy fields
                connection_id=connection_id,
                connection_name=connection_name,
                payload=payload,
                status=status,
            )
            db.add(entry)
            # Flush to get the entry ID for hash computation
            db.flush()

            # Compute hash chain (AUDIT-T3)
            _compute_and_set_hash(db, entry)

    except Exception as exc:
        logger.warning("Failed to write audit log (%s): %s", event_type, exc)

    return correlation_id


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
    """Legacy audit helper — delegates to emit_audit_event for backward compatibility."""
    emit_audit_event(
        db=db,
        event_type=event_type,
        actor=actor,
        module="legacy",
        connection_id=connection_id,
        connection_name=connection_name,
        payload=payload,
        outcome=status,
        status=status,
        duration_ms=duration_ms,
    )


def _compute_and_set_hash(db: Session, entry: AuditLog) -> None:
    """Compute and set the hash chain for an audit entry (AUDIT-T3).

    event_hash = SHA256(canonical_json_of_event + "|" + prev_hash)
    """
    # Get the previous entry's hash
    prev_entry = (
        db.query(AuditLog)
        .filter(AuditLog.id < entry.id)
        .order_by(AuditLog.id.desc())
        .first()
    )
    prev_hash = prev_entry.event_hash if prev_entry else None

    # Build canonical content for hashing
    content = _build_canonical_content(entry, prev_hash)

    # Compute hash
    event_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

    # Update the entry
    entry.event_hash = event_hash
    entry.prev_hash = prev_hash
    entry.sequence = (prev_entry.sequence + 1) if prev_entry and prev_entry.sequence else 1


def _build_canonical_content(entry: AuditLog, prev_hash: Optional[str]) -> str:
    """Build canonical string for hash computation.

    Uses sorted keys for deterministic serialization.
    """
    data = {
        "id": entry.id,
        "event_type": entry.event_type,
        "actor": entry.actor,
        "module": entry.module,
        "target_type": entry.target_type,
        "target_id": entry.target_id,
        "target_name": entry.target_name,
        "before_summary": entry.before_summary,
        "after_summary": entry.after_summary,
        "correlation_id": entry.correlation_id,
        "outcome": entry.outcome,
        "summary": entry.summary,
        "duration_ms": entry.duration_ms,
        "metadata": entry.metadata,
        "created_at": (
            entry.created_at.isoformat() if entry.created_at
            else datetime.now(timezone.utc).isoformat()
        ),
    }
    canonical = json.dumps(data, sort_keys=True, default=str)
    return f"{canonical}|{prev_hash or ''}"


def verify_hash_chain(db: Session) -> Dict[str, Any]:
    """Verify the integrity of the entire audit hash chain (AUDIT-T3).

    Walks the chain from the first event forward, recomputing hashes
    and comparing with stored values.
    """
    entries = db.query(AuditLog).order_by(AuditLog.id.asc()).all()

    if not entries:
        return {"valid": True, "total_events": 0, "verified_events": 0}

    tampered: list[int] = []
    chain_broken_at: Optional[int] = None
    prev_hash: Optional[str] = None

    for entry in entries:
        # Skip entries without hash (pre-hash-chain legacy events)
        if not entry.event_hash:
            prev_hash = None
            continue

        content = _build_canonical_content(entry, prev_hash)
        expected_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        if entry.event_hash != expected_hash:
            tampered.append(entry.id)
            if chain_broken_at is None:
                chain_broken_at = entry.id

        if entry.prev_hash != prev_hash:
            # Chain continuity broken
            if chain_broken_at is None:
                chain_broken_at = entry.id

        prev_hash = entry.event_hash

    return {
        "valid": len(tampered) == 0 and chain_broken_at is None,
        "total_events": len(entries),
        "verified_events": len(entries) - len(tampered),
        "chain_broken_at": chain_broken_at,
        "tampered_events": tampered,
    }