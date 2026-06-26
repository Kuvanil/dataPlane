from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.connection import DBConnection
from app.services.schema_service import SchemaService
from app.tasks.ai_tasks import match_schemas_task

router = APIRouter()


@router.post("/suggest")
def suggest_transformation(
    source_id: int,
    target_id: int,
    source_table: str,
    target_table: str,
    db: Session = Depends(get_db),
):
    """
    Enqueue an AI schema-matching job and return its Celery task id.
    Poll GET /api/v1/tasks/{task_id} for results.
    """
    source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target Connection not found")

    # Light pre-flight check (cheap DB lookup) so the caller fails fast
    # on bad table names before we enqueue the heavy job.
    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        if source_table not in source_schema:
            raise HTTPException(
                status_code=400,
                detail=f"Table '{source_table}' not found in Source '{source_conn.name}'",
            )
        if target_table not in target_schema:
            raise HTTPException(
                status_code=400,
                detail=f"Table '{target_table}' not found in Target '{target_conn.name}'",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema preflight failed: {str(e)}")

    task = match_schemas_task.delay(source_id, target_id, source_table, target_table)
    return {"task_id": task.id, "status": "PENDING"}


@router.post("/schema-match")
def schema_match(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Enqueue a schema-wide AI matching job across ALL source vs target tables.
    Poll GET /api/v1/tasks/{task_id} for results.
    """
    if source_id == target_id:
        raise HTTPException(
            status_code=400,
            detail="Source and target must be different databases",
        )

    source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target Connection not found")

    # Local import keeps the existing import block untouched and avoids loading
    # the worker task module unless this endpoint is actually hit.
    from app.tasks.ai_tasks import schema_wide_match_task

    task = schema_wide_match_task.delay(source_id, target_id)
    return {"task_id": task.id, "status": "PENDING"}
