from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
from app.core.database import get_db
from app.models.connection import DBConnection
from app.services.schema_service import SchemaService
from app.services.ai_service import AIService
from app.services.schema_mapper_service import SchemaMapperService
from app.tasks.ai_tasks import (
    parse_english_mapping_task,
    generate_migration_task,
)

router = APIRouter()


class ParseRequest(BaseModel):
    text: str
    source_id: int
    target_id: int


class GenerateSQLRequest(BaseModel):
    mappings: List[Dict[str, Any]]
    target_db_type: str = "sqlite"


class VisualMapRequest(BaseModel):
    source_id: int
    target_id: int


@router.post("/parse")
def parse_english(req: ParseRequest, db: Session = Depends(get_db)):
    """Enqueue an English→mapping-rules parsing job and return its task id."""
    source_conn = db.query(DBConnection).filter(DBConnection.id == req.source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == req.target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target connection not found")

    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema preflight failed: {str(e)}")

    task = parse_english_mapping_task.delay(
        text=req.text,
        source_schema_json=json.dumps(source_schema),
        target_schema_json=json.dumps(target_schema),
    )
    return {
        "task_id": task.id,
        "status": "PENDING",
        "source": source_conn.name,
        "target": target_conn.name,
    }


@router.post("/generate-sql")
def generate_sql(req: GenerateSQLRequest):
    """Enqueue a mapping-rules→migration-SQL job and return its task id."""
    try:
        task = generate_migration_task.delay(
            mappings_json=json.dumps(req.mappings),
            target_db_type=req.target_db_type,
        )
        return {"task_id": task.id, "status": "PENDING"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL generation enqueue failed: {str(e)}")


@router.post("/visual-data")
def get_visual_mapping(req: VisualMapRequest, db: Session = Depends(get_db)):
    """Get structured data for the visual schema mapper UI (sync, lightweight)."""
    source_conn = db.query(DBConnection).filter(DBConnection.id == req.source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == req.target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target connection not found")

    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        # Get AI matches for first table pair
        ai_matches = []
        src_tables = list(source_schema.keys())
        tgt_tables = list(target_schema.keys())
        if src_tables and tgt_tables:
            match_result = AIService.match_schemas(
                source_name=src_tables[0],
                source_schema=source_schema[src_tables[0]],
                target_name=tgt_tables[0],
                target_schema=target_schema[tgt_tables[0]],
            )
            ai_matches = match_result.get("matches", [])

        result = SchemaMapperService.get_visual_mapping_data(
            source_schema=source_schema,
            target_schema=target_schema,
            ai_matches=ai_matches,
        )
        result["source_name"] = source_conn.name
        result["target_name"] = target_conn.name
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Visual mapping failed: {str(e)}")
