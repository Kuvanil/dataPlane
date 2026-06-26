from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any
from app.core.database import get_db
from app.models.connection import DBConnection
from app.services.schema_service import SchemaService
from app.services.diff_service import DiffService
from app.services.security_service import SecurityService
from app.services.ai_service import AIService
from app.services.askdata_service import AskDataService
from app.tasks.ai_tasks import nl2sql_task
import uuid

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class NL2SQLRequest(BaseModel):
    connection_id: int
    question: str
    execute: bool = False  # noqa: F841 — accepted for API stability


@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """Chat with AskData AI about database issues, needs, and challenges."""
    session_id = req.session_id or str(uuid.uuid4())

    # Build comprehensive context from all connections
    context = _build_full_context(db)

    try:
        response = AskDataService.chat(
            message=req.message,
            session_id=session_id,
            context=context,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AskData chat failed: {str(e)}")


@router.post("/nl2sql")
def nl2sql(req: NL2SQLRequest, db: Session = Depends(get_db)):
    """Enqueue an NL→SQL translation job and return its Celery task id."""
    conn = db.query(DBConnection).filter(DBConnection.id == req.connection_id).first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    task = nl2sql_task.delay(
        connection_id=req.connection_id,
        question=req.question,
        execute=req.execute,
    )
    return {"task_id": task.id, "status": "PENDING"}


@router.get("/suggestions")
def get_suggestions(db: Session = Depends(get_db)):
    """Get contextual question suggestions based on current database state."""
    context = _build_full_context(db)
    suggestions = AskDataService.get_suggestions(context)
    return {"suggestions": suggestions}


@router.delete("/session/{session_id}")
def clear_session(session_id: str):
    """Clear a chat session's history."""
    AskDataService.clear_session(session_id)
    return {"status": "cleared", "session_id": session_id}


def _build_full_context(db: Session) -> Dict[str, Any]:
    """Build comprehensive context from all connected databases."""
    connections = db.query(DBConnection).all()

    schemas: Dict[str, Any] = {}
    classifications: Dict[str, Any] = {}
    diffs: Dict[str, Any] = {}
    matches: Dict[str, Any] = {}

    for conn in connections:
        try:
            schema = SchemaService.get_full_schema(conn)
            schemas[conn.name] = schema

            # Classify each schema
            cls_data = SecurityService.classify_schema(schema)
            classifications[conn.name] = cls_data
        except Exception:
            continue

    # Run diffs between pairs of connections
    conn_list = list(connections)
    for i in range(len(conn_list)):
        for j in range(i + 1, len(conn_list)):
            try:
                s1 = schemas.get(conn_list[i].name, {})
                s2 = schemas.get(conn_list[j].name, {})
                diff_result = DiffService.compare_schemas(s1, s2)
                diff_key = f"{conn_list[i].name} ↔ {conn_list[j].name}"
                diffs[diff_key] = diff_result

                # Run AI matching for each matching table pair
                for src_table in s1:
                    for tgt_table in s2:
                        try:
                            match_result = AIService.match_schemas(
                                source_name=src_table,
                                source_schema=s1[src_table],
                                target_name=tgt_table,
                                target_schema=s2[tgt_table],
                            )
                            match_key = f"{src_table} → {tgt_table}"
                            matches[match_key] = match_result
                        except Exception:
                            continue
            except Exception:
                continue

    return {
        "schemas": schemas,
        "classifications": classifications,
        "diffs": diffs,
        "matches": matches,
        "connection_count": len(connections),
    }
