"""Pydantic schemas for the Schema Intel catalog API (Task #1)."""
from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel, ConfigDict


# ── Response bodies ──────────────────────────────────────────────────


class CatalogForeignKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    references_table: str
    references_column: str


class CatalogColumnResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    column_name: str
    data_type: str | None
    nullable: bool
    is_primary_key: bool
    ordinal_position: int
    foreign_keys: List[CatalogForeignKeyResponse] = []


class CatalogTableResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_id: int
    table_name: str
    last_scanned_at: datetime
    columns: List[CatalogColumnResponse] = []


class CatalogTableListResponse(BaseModel):
    connection_id: int
    tables: List[CatalogTableResponse]


class ScanResult(BaseModel):
    connection_id: int
    tables_scanned: int
    columns_scanned: int
    scanned_at: datetime
