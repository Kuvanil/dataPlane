from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey, Index
from sqlalchemy.sql import func
from app.core.database import Base


class SchemaSnapshot(Base):
    __tablename__ = "schema_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="CASCADE"), nullable=False)
    connection_name = Column(String, nullable=False)
    schema_hash = Column(String, nullable=False)
    schema_json = Column(JSON, nullable=False)
    captured_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_schema_snapshots_conn_captured", "connection_id", "captured_at"),
    )
