"""Schema Intel catalog API: persisted discovery (Task #1, FR1/AC1)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.schema_catalog import CatalogColumn, CatalogTable
from app.models.user import User
from app.schemas.schema_catalog import (
    CatalogColumnResponse, CatalogForeignKeyResponse, CatalogTableListResponse,
    CatalogTableResponse, ScanResult,
)
from app.services.schema_catalog_service import SchemaCatalogService

router = APIRouter()


def _column_response(col: CatalogColumn) -> CatalogColumnResponse:
    return CatalogColumnResponse(
        id=col.id,
        column_name=col.column_name,
        data_type=col.data_type,
        nullable=col.nullable,
        is_primary_key=col.is_primary_key,
        ordinal_position=col.ordinal_position,
        foreign_keys=[
            CatalogForeignKeyResponse(
                references_table=fk.references_table,
                references_column=fk.references_column,
            )
            for fk in col.foreign_keys_rel
        ],
    )


def _table_response(table: CatalogTable) -> CatalogTableResponse:
    return CatalogTableResponse(
        id=table.id,
        connection_id=table.connection_id,
        table_name=table.table_name,
        last_scanned_at=table.last_scanned_at,
        columns=[_column_response(c) for c in sorted(table.columns, key=lambda c: c.ordinal_position)],
    )


@router.post("/scan/{connection_id}", response_model=ScanResult, status_code=201)
def scan_connection(
    connection_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    result = SchemaCatalogService.scan_connection(db, connection_id, actor=user.email)
    return ScanResult(**result)


@router.get("/{connection_id}/tables", response_model=CatalogTableListResponse)
def list_catalog_tables(connection_id: int, db: Session = Depends(get_db)):
    tables: List[CatalogTable] = SchemaCatalogService.get_catalog(db, connection_id)
    return CatalogTableListResponse(
        connection_id=connection_id,
        tables=[_table_response(t) for t in tables],
    )
