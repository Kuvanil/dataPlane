"""Schema Intel catalog service: persisted discovery (Task #1, FR1/AC1).

Persists what `SchemaService.get_full_schema()` already discovers live, so
search (Task #4), profiling (Task #2), and classification (Task #3) have a
normalized store to read/attach to instead of recomputing from the connector
on every request.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models.connection import DBConnection
from app.models.schema_catalog import CatalogColumn, CatalogForeignKey, CatalogTable
from app.services.audit_helper import record_audit
from app.services.schema_service import SchemaService

logger = logging.getLogger(__name__)


class SchemaCatalogService:

    @staticmethod
    def _get_connection_or_404(db: Session, connection_id: int) -> DBConnection:
        conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Connection not found")
        return conn

    @staticmethod
    def scan_connection(db: Session, connection_id: int, *, actor: str) -> dict:
        """Discover the connection's current schema and persist it as a catalog.

        Full-replace semantics per table: a table's columns/foreign-keys are
        deleted and recreated fresh from the connector's current output
        rather than diffed in place (simplest correct approach — this is a
        metadata scan, not a hot path). Tables no longer returned by the
        connector are deleted (cascades to their columns/FKs via the
        relationship's cascade="all, delete-orphan" + FK ondelete="CASCADE").
        """
        conn = SchemaCatalogService._get_connection_or_404(db, connection_id)
        schema = SchemaService.get_full_schema(conn)

        existing_tables = {
            t.table_name: t
            for t in db.query(CatalogTable)
            .filter(CatalogTable.connection_id == connection_id)
            .all()
        }
        seen_table_names = set(schema.keys())
        now = datetime.now(timezone.utc)
        columns_scanned = 0

        for table_name, columns in schema.items():
            table = existing_tables.get(table_name)
            if table is None:
                table = CatalogTable(connection_id=connection_id, table_name=table_name)
                db.add(table)
                db.flush()
            else:
                # Full-replace: drop existing columns (cascades to their FKs)
                # before re-inserting the current set.
                for col in list(table.columns):
                    db.delete(col)
                db.flush()
            table.last_scanned_at = now

            for position, col in enumerate(columns):
                catalog_col = CatalogColumn(
                    table_id=table.id,
                    column_name=col["name"],
                    data_type=col.get("type"),
                    nullable=bool(col.get("nullable", True)),
                    is_primary_key=bool(col.get("primary_key", False)),
                    ordinal_position=position,
                )
                db.add(catalog_col)
                db.flush()
                columns_scanned += 1
                for fk in col.get("foreign_keys") or []:
                    db.add(CatalogForeignKey(
                        column_id=catalog_col.id,
                        references_table=fk["references_table"],
                        references_column=fk["references_column"],
                    ))

        # Remove tables no longer present at the source.
        for table_name, table in existing_tables.items():
            if table_name not in seen_table_names:
                db.delete(table)

        record_audit(
            db, "schema_scanned", actor=actor,
            connection_id=conn.id, connection_name=conn.name,
            payload={"tables_scanned": len(seen_table_names), "columns_scanned": columns_scanned},
        )
        db.commit()

        return {
            "connection_id": connection_id,
            "tables_scanned": len(seen_table_names),
            "columns_scanned": columns_scanned,
            "scanned_at": now,
        }

    @staticmethod
    def get_catalog(db: Session, connection_id: int) -> List[CatalogTable]:
        SchemaCatalogService._get_connection_or_404(db, connection_id)
        return (
            db.query(CatalogTable)
            .filter(CatalogTable.connection_id == connection_id)
            .options(
                joinedload(CatalogTable.columns).joinedload(CatalogColumn.foreign_keys_rel),
            )
            .order_by(CatalogTable.table_name)
            .all()
        )
