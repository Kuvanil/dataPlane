from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, BigInteger
from sqlalchemy.sql import func
from app.core.database import Base


class AuditLog(Base):
    """Canonical audit event store with tamper-evident hash chain support.

    See AUDIT-T1 for the canonical schema definition and AUDIT-T3 for the
    hash chain implementation (event_hash, prev_hash, sequence).
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)

    # Core identity (FR1)
    event_type = Column(String, nullable=False, index=True)
    actor = Column(String, nullable=False, default="system", index=True)
    module = Column(String, nullable=True, index=True)  # Source module: connectors, query_studio, askdata, etc.

    # Target (FR4, FR8)
    target_type = Column(String, nullable=True)           # connection, query, pipeline, mapping, etc.
    target_id = Column(String, nullable=True)             # ID of the target entity (string for flexibility)
    target_name = Column(String, nullable=True)           # Human-readable name of the target

    # Before/After for state-changing operations (FR1)
    before_summary = Column(JSON, nullable=True)
    after_summary = Column(JSON, nullable=True)

    # Correlation (FR8)
    correlation_id = Column(String, nullable=True, index=True)

    # Outcome
    outcome = Column(String, nullable=False, default="success")  # success, failure, warning
    summary = Column(Text, nullable=True)                         # Human-readable summary

    # Timing
    duration_ms = Column(Integer, nullable=True)

    # Metadata / payload
    metadata = Column(JSON, nullable=True)  # Additional structured data

    # Legacy fields (kept for backward compatibility)
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    connection_name = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)   # Legacy unstructured payload
    status = Column(String, nullable=False, default="success")  # Legacy status field

    # Tamper-evidence (AUDIT-T3)
    event_hash = Column(String, nullable=True)   # SHA-256 of this event's content + prev_hash
    prev_hash = Column(String, nullable=True)    # SHA-256 of the previous event's hash
    sequence = Column(BigInteger, nullable=True) # Monotonically increasing sequence number

    # Timestamp
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)