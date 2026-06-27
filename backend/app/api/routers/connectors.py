import logging
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.connection import DBConnection
from app.schemas.connection import ConnectionCreate, ConnectionResponse
from app.services.schema_service import SchemaService
from app.services.audit_helper import record_audit
from app.api.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

VALID_TYPES = {"sqlite", "postgres", "mysql", "oracle", "jdbc"}
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")


def _get_or_404(id: int, db: Session) -> DBConnection:
    conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


@router.post("/", response_model=ConnectionResponse, status_code=201)
def create_connection(conn: ConnectionCreate, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Create a new database connector saved to local state."""
    if not _NAME_RE.match(conn.name):
        raise HTTPException(
            status_code=422,
            detail="Name must be 1–100 alphanumeric/underscore/hyphen characters",
        )
    if conn.type not in VALID_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported connector type '{conn.type}'. Valid: {sorted(VALID_TYPES)}",
        )
    if not isinstance(conn.config, dict):
        raise HTTPException(status_code=422, detail="config must be a JSON object")

    existing = db.query(DBConnection).filter(DBConnection.name == conn.name).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A connector named '{conn.name}' already exists")

    db_conn = DBConnection(name=conn.name, type=conn.type, config=conn.config)
    db.add(db_conn)
    db.commit()
    db.refresh(db_conn)
    logger.info("Created connector '%s' (type=%s, id=%d)", db_conn.name, db_conn.type, db_conn.id)
    record_audit(db, "connector_created", connection_id=db_conn.id, connection_name=db_conn.name,
                 payload={"type": db_conn.type})
    return db_conn


@router.get("/", response_model=List[ConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    """List all configured database connectors."""
    return db.query(DBConnection).all()


@router.get("/{id}", response_model=ConnectionResponse)
def get_connection(id: int, db: Session = Depends(get_db)):
    """Get connection details by ID."""
    return _get_or_404(id, db)


@router.delete("/{id}", status_code=204)
def delete_connection(id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Delete a connector by ID."""
    db_conn = _get_or_404(id, db)
    logger.info("Deleting connector '%s' (id=%d)", db_conn.name, db_conn.id)
    record_audit(db, "connector_deleted", connection_id=db_conn.id, connection_name=db_conn.name)
    db.delete(db_conn)
    db.commit()


@router.post("/{id}/test")
def test_connection(id: int, db: Session = Depends(get_db)):
    """Test whether the connector credentials successfully reach the database."""
    db_conn = _get_or_404(id, db)
    success = SchemaService.test_connection(db_conn)
    status = "connected" if success else "failed"
    logger.info("Connection test for '%s' (id=%d): %s", db_conn.name, id, status)
    return {"id": id, "name": db_conn.name, "status": status}


@router.get("/{id}/schema")
def get_schema(id: int, db: Session = Depends(get_db)):
    """Extract full structural schema metadata from the connector."""
    db_conn = _get_or_404(id, db)
    try:
        schema_data = SchemaService.get_full_schema(db_conn)
        return {"id": id, "name": db_conn.name, "schema": schema_data}
    except Exception as e:
        logger.error("Schema extraction failed for connector %d: %s", id, e)
        raise HTTPException(status_code=500, detail=f"Schema extraction failed: {str(e)}")
