import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from app.core.database import get_db
from app.models.connection import DBConnection
from app.models.autopilot import AutopilotRun, AutopilotLog

logger = logging.getLogger(__name__)
router = APIRouter()


class RunAutopilotRequest(BaseModel):
    source_id: int
    target_id: int
    mode: str = "suggest"  # suggest | execute
    model: str = "llama3"


@router.post("/run")
def start_autopilot_run(req: RunAutopilotRequest, db: Session = Depends(get_db)):
    """Enqueue an autopilot agent run and return its run_id."""
    source_conn = db.query(DBConnection).filter(DBConnection.id == req.source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == req.target_id).first()
    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or target connection not found")
    if req.source_id == req.target_id:
        raise HTTPException(status_code=400, detail="Source and target must be different connections")

    run_id = str(uuid.uuid4())
    run = AutopilotRun(
        id=run_id,
        source_id=req.source_id,
        target_id=req.target_id,
        mode=req.mode,
        model=req.model,
        status="running",
    )
    db.add(run)
    db.commit()

    from app.tasks.ai_tasks import run_autopilot_task
    run_autopilot_task.delay(run_id=run_id, source_id=req.source_id, target_id=req.target_id, mode=req.mode)
    logger.info("Autopilot run %s started (source=%s, target=%s, mode=%s)", run_id, req.source_id, req.target_id, req.mode)
    return {"run_id": run_id, "status": "running"}


@router.get("/runs")
def list_runs(db: Session = Depends(get_db)):
    """List the last 20 autopilot runs."""
    runs = (
        db.query(AutopilotRun)
        .order_by(AutopilotRun.started_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": r.id,
            "source_id": r.source_id,
            "target_id": r.target_id,
            "mode": r.mode,
            "model": r.model,
            "status": r.status,
            "started_at": r.started_at,
            "completed_at": r.completed_at,
        }
        for r in runs
    ]


@router.get("/runs/{run_id}/logs")
def get_run_logs(run_id: str, db: Session = Depends(get_db)):
    """Return all log entries for an autopilot run (for console streaming)."""
    run = db.query(AutopilotRun).filter(AutopilotRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    logs = (
        db.query(AutopilotLog)
        .filter(AutopilotLog.run_id == run_id)
        .order_by(AutopilotLog.created_at.asc())
        .all()
    )
    return {
        "run_id": run_id,
        "status": run.status,
        "logs": [
            {
                "step": lg.step,
                "message": lg.message,
                "level": lg.level,
                "created_at": lg.created_at,
            }
            for lg in logs
        ],
    }


@router.get("/runs/{run_id}/status")
def get_run_status(run_id: str, db: Session = Depends(get_db)):
    """Summary status of an autopilot run."""
    run = db.query(AutopilotRun).filter(AutopilotRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        "run_id": run_id,
        "status": run.status,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "result_summary": run.result_summary,
    }
