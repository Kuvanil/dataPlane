"""Schema Intel catalog API: persisted discovery, search, profiling, and
manual classification override (Tasks #1, #2, #4, #7)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.schema_catalog import CatalogColumn, CatalogTable
from app.models.user import User
from app.schemas.schema_catalog import (
    CatalogColumnResponse, CatalogForeignKeyResponse, CatalogTableListResponse,
    CatalogTableResponse, ClassificationOverrideRequest, ColumnClassificationResponse,
    ColumnProfileResponse, ProfileEnqueueResult, ScanResult,
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
        profile=ColumnProfileResponse.model_validate(col.profile) if col.profile else None,
        classification=(
            ColumnClassificationResponse.model_validate(col.classification)
            if col.classification else None
        ),
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
def list_catalog_tables(
    connection_id: int,
    q: Optional[str] = Query(None, description="Search table/column names (Task #4, FR4)"),
    data_type: Optional[str] = Query(None, description="Filter by exact column data type"),
    classification_label: Optional[str] = Query(
        None, pattern="^(PII|Sensitive|Public)$",
        description="Filter by classification label",
    ),
    db: Session = Depends(get_db),
):
    tables: List[CatalogTable] = SchemaCatalogService.get_catalog(
        db, connection_id, q=q, data_type=data_type, classification_label=classification_label,
    )
    return CatalogTableListResponse(
        connection_id=connection_id,
        tables=[_table_response(t) for t in tables],
    )


# ── Task #2: profiling ──────────────────────────────────────────────

@router.post("/{connection_id}/profile", response_model=ProfileEnqueueResult, status_code=202)
def profile_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Enqueue profiling for every table discovered in this connection's
    catalog. Requires a prior scan (POST /scan/{connection_id})."""
    from app.models.connection import DBConnection

    conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="connection not found")

    table_count = db.query(CatalogTable).filter(CatalogTable.connection_id == connection_id).count()
    if table_count == 0:
        raise HTTPException(
            status_code=400,
            detail="no catalog tables found; run a scan (POST /scan/{connection_id}) first",
        )

    from app.tasks.schema_intel_tasks import profile_connection_task
    task = profile_connection_task.delay(connection_id)

    from app.services.audit_helper import record_audit
    record_audit(
        db, "profiling_started", actor=user.email,
        connection_id=connection_id, connection_name=conn.name,
        payload={"task_id": task.id, "tables": table_count},
    )
    db.commit()

    return ProfileEnqueueResult(
        status="queued", task_id=task.id,
        message=f"Profiling {table_count} table(s). Poll GET /api/v1/tasks/{{task_id}} for status.",
    )


# ── Task #7: manual classification override ──────────────────────────

@router.put("/columns/{column_id}/classification", response_model=ColumnClassificationResponse)
def override_classification(
    column_id: int,
    req: ClassificationOverrideRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    row = SchemaCatalogService.override_classification(
        db, column_id, label=req.label, level=req.level, actor=user.email,
    )
    return ColumnClassificationResponse.model_validate(row)
