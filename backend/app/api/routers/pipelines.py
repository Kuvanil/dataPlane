import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict, Any
from app.core.database import get_db
from app.services.pipeline_service import PipelineService
from app.services.audit_helper import record_audit

router = APIRouter()

class NodeConfig(BaseModel):
    connection_id: int | None = None

class PipelineNode(BaseModel):
    id: str
    type: str
    config: NodeConfig | None = None
    position: Dict[str, float] | None = None

class PipelineEdge(BaseModel):
    id: str
    source: str
    target: str

class ExecutePipelineRequest(BaseModel):
    nodes: List[PipelineNode]
    edges: List[PipelineEdge]

@router.post("/execute")
def execute_pipeline(req: ExecutePipelineRequest, db: Session = Depends(get_db)):
    start_ms = int(time.time() * 1000)
    try:
        result = PipelineService.execute_pipeline(
            nodes=[n.model_dump() for n in req.nodes],
            edges=[e.model_dump() for e in req.edges]
        )
        duration_ms = int(time.time() * 1000) - start_ms
        record_audit(db, "pipeline_run", status="success", duration_ms=duration_ms,
                     payload={
                         "source": result.get("source"),
                         "target": result.get("target"),
                         "table_mappings": len(result.get("table_mappings", [])),
                         "rows_copied": result.get("rows_copied", 0),
                     })
        return result
    except ValueError as e:
        record_audit(db, "pipeline_run", status="failure",
                     payload={"error": str(e)})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        record_audit(db, "pipeline_run", status="failure",
                     payload={"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")
