from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.connection import DBConnection
from app.schemas.connection import ConnectionCreate, ConnectionResponse
from app.services.schema_service import SchemaService

router = APIRouter()

@router.post("/", response_model=ConnectionResponse)
def create_connection(conn: ConnectionCreate, db: Session = Depends(get_db)):
    """
    Create a new database connector saved to local state.
    """
    db_conn = DBConnection(
        name=conn.name,
        type=conn.type,
        config=conn.config
    )
    db.add(db_conn)
    db.commit()
    db.refresh(db_conn)
    return db_conn

@router.get("/", response_model=List[ConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    """
    List all configured database connectors.
    """
    return db.query(DBConnection).all()

@router.get("/{id}", response_model=ConnectionResponse)
def get_connection(id: int, db: Session = Depends(get_db)):
    """
    Get connection details by ID.
    """
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return db_conn

@router.post("/{id}/test")
def test_connection(id: int, db: Session = Depends(get_db)):
    """
    Trigger validation to test if credentials successfully connect.
    """
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    success = SchemaService.test_connection(db_conn)
    return {"id": id, "status": "connected" if success else "failed"}

@router.get("/{id}/schema")
def get_schema(id: int, db: Session = Depends(get_db)):
    """
    Extract full structural schema metadata from the loaded connector.
    """
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    try:
        schema_data = SchemaService.get_full_schema(db_conn)
        return {"id": id, "name": db_conn.name, "schema": schema_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema Extraction Failed: {str(e)}")
