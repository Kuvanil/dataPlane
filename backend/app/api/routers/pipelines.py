from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from app.services.pipeline_service import PipelineService

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
def execute_pipeline(req: ExecutePipelineRequest):
    try:
        result = PipelineService.execute_pipeline(
            nodes=[n.model_dump() for n in req.nodes],
            edges=[e.model_dump() for e in req.edges]
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")
