from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class AutopilotRun(Base):
    __tablename__ = "autopilot_runs"

    id = Column(String, primary_key=True)  # UUID string
    source_id = Column(Integer, nullable=False)
    target_id = Column(Integer, nullable=False)
    mode = Column(String, nullable=False, default="suggest")  # suggest | execute
    model = Column(String, nullable=False, default="llama3")
    status = Column(String, nullable=False, default="running")  # running | completed | failed
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    result_summary = Column(JSON, nullable=True)


class AutopilotLog(Base):
    __tablename__ = "autopilot_logs"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("autopilot_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    level = Column(String, nullable=False, default="info")  # info | warning | error
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
