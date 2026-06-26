from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from app.core.database import get_db
from app.models.connection import DBConnection
from app.services.schema_service import SchemaService, get_connector
from app.services.nl2sql_service import NL2SQLService

router = APIRouter()


class NL2SQLRequest(BaseModel):
    query: str
    connection_id: int = 1
    execute: bool = True


class NL2SQLResponse(BaseModel):
    sql: str
    method: str
    confidence: int
    results: Optional[Any] = None
    row_count: Optional[int] = None
    error: Optional[str] = None
    report_type: Optional[str] = None


# ── In-memory query history for demo ──────────────────────────
_history: List[Dict[str, Any]] = []


@router.post("/nl2sql")
def nl_to_sql(req: NL2SQLRequest, db: Session = Depends(get_db)):
    """Convert natural language query to SQL and optionally execute it."""
    conn = db.query(DBConnection).filter(DBConnection.id == req.connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        # Get schema context
        schema_context = SchemaService.get_full_schema(conn)

        # Generate SQL
        result = NL2SQLService.generate_sql(req.query, schema_context, conn.type)

        # Check for analysis-type results (no execution needed)
        if result.get("report_type"):
            entry = {
                "query": req.query,
                "sql": result["sql"],
                "method": result["method"],
                "confidence": result["confidence"],
                "results": result.get("results"),
                "report_type": result.get("report_type"),
                "connection": conn.name,
            }
            _history.insert(0, entry)
            return entry

        # Execute if requested and safe
        if req.execute and result.get("confidence", 0) > 0 and not result.get("blocked"):
            connector = get_connector(conn)
            try:
                exec_result = NL2SQLService.execute_safe_query(connector, result["sql"])
                result.update(exec_result)
            finally:
                connector.close()

        entry = {
            "query": req.query,
            "sql": result["sql"],
            "method": result["method"],
            "confidence": result["confidence"],
            "results": result.get("results", []),
            "row_count": result.get("row_count"),
            "error": result.get("error"),
            "connection": conn.name,
        }
        _history.insert(0, entry)
        if len(_history) > 50:
            _history.pop()
        return entry

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"NL2SQL failed: {str(e)}")


@router.get("/report/{connection_id}")
def generate_report(connection_id: int, db: Session = Depends(get_db)):
    """Generate a comprehensive analysis report for a connection."""
    conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        schema_context = SchemaService.get_full_schema(conn)
        report = NL2SQLService.generate_analysis_report(schema_context)
        report["connection"] = conn.name
        report["connection_type"] = conn.type
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


@router.get("/history")
def get_history():
    """Return recent query history."""
    return {"history": _history[:20]}
