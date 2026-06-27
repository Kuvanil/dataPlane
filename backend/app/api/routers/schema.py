from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.connection import DBConnection
from app.services.schema_service import SchemaService
from app.services.diff_service import DiffService
from app.services.security_service import SecurityService
from app.services.ai_service import AIService
from app.services.audit_helper import record_audit

router = APIRouter()

@router.get("/diff")
def compare_schemas(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Compare two connected database schemas and find structural differences.
    """
    source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target Connection not found")

    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)
        
        diff_results = DiffService.compare_schemas(source_schema, target_schema)
        return {
            "source": source_conn.name,
            "target": target_conn.name,
            "diff": diff_results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diff failed: {str(e)}")

@router.get("/{id}/classify")
def classify_schema(id: int, db: Session = Depends(get_db)):
    """
    Apply DAMA data governance classifications to columns structure metadata.
    """
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        schema_data = SchemaService.get_full_schema(db_conn)
        classifications = SecurityService.classify_schema(schema_data)
        pii_count = sum(
            1 for cols in classifications.values()
            for c in cols
            if isinstance(c, dict) and c.get("classification", {}).get("level") == "High"
        )
        record_audit(db, "schema_classified", connection_id=db_conn.id, connection_name=db_conn.name,
                     payload={"tables": len(schema_data), "pii_columns": pii_count})
        return {
            "name": db_conn.name,
            "classifications": classifications
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")

@router.get("/{id}/drift-history")
def get_drift_history(id: int, db: Session = Depends(get_db)):
    """Return the last 5 schema snapshots for a connection."""
    from app.models.schema_snapshot import SchemaSnapshot
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    snapshots = (
        db.query(SchemaSnapshot)
        .filter(SchemaSnapshot.connection_id == id)
        .order_by(SchemaSnapshot.captured_at.desc())
        .limit(5)
        .all()
    )
    return {
        "connection": db_conn.name,
        "snapshots": [
            {
                "id": s.id,
                "schema_hash": s.schema_hash,
                "captured_at": s.captured_at,
                "table_count": len(s.schema_json) if s.schema_json else 0,
            }
            for s in snapshots
        ],
    }


@router.get("/graph")
def get_graph_data(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Generate graph-structured data for Neo4j/NetworkX-style visualization.
    Combines schema metadata, diff results, security classifications, and AI matches.
    """
    source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
    target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

    if not source_conn or not target_conn:
        raise HTTPException(status_code=404, detail="Source or Target Connection not found")

    try:
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        # Diff
        diff_result = DiffService.compare_schemas(source_schema, target_schema)

        # Classifications for source
        source_classifications = SecurityService.classify_schema(source_schema)

        # AI matches for first table pair
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

        graph = DiffService.generate_graph_data(
            source_schema=source_schema,
            target_schema=target_schema,
            diff_result=diff_result,
            classifications=source_classifications,
            ai_matches=ai_matches,
            source_name=source_conn.name,
            target_name=target_conn.name,
        )
        return graph
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph generation failed: {str(e)}")
