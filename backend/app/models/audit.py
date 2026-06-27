from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    actor = Column(String, nullable=False, default="system")
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    connection_name = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="success")  # success | failure | warning
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
