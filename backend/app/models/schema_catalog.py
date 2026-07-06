"""Schema Intel catalog models (Task #1, FR1/AC1).

Tables:
    catalog_tables        — one row per discovered table per connection.
    catalog_columns       — one row per column, child of catalog_tables.
    catalog_foreign_keys  — one row per detected FK reference, child of catalog_columns.

Persists what `SchemaService.get_full_schema()` already discovers live on every
request, so search (Task #4), profiling (Task #2), and classification (Task #3)
have a normalized store to attach to instead of recomputing from the connector
on every call. See `SchemaCatalogService.scan_connection` for the
full-replace-per-table upsert that populates these tables.
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CatalogTable(Base):
    __tablename__ = "catalog_tables"
    __table_args__ = (
        UniqueConstraint("connection_id", "table_name", name="uq_catalog_table_per_connection"),
    )

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("connections.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    table_name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    last_scanned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    columns = relationship(
        "CatalogColumn",
        back_populates="table",
        cascade="all, delete-orphan",
    )


class CatalogColumn(Base):
    __tablename__ = "catalog_columns"
    __table_args__ = (
        UniqueConstraint("table_id", "column_name", name="uq_catalog_column_per_table"),
    )

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("catalog_tables.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    column_name = Column(String, nullable=False)
    data_type = Column(String, nullable=True)
    nullable = Column(Boolean, nullable=False, default=True)
    is_primary_key = Column(Boolean, nullable=False, default=False)
    ordinal_position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    table = relationship("CatalogTable", back_populates="columns")
    # Named to avoid clashing with SQLAlchemy's own `foreign_keys` kwarg.
    foreign_keys_rel = relationship(
        "CatalogForeignKey",
        back_populates="column",
        cascade="all, delete-orphan",
    )


class CatalogForeignKey(Base):
    __tablename__ = "catalog_foreign_keys"

    id = Column(Integer, primary_key=True, index=True)
    column_id = Column(Integer, ForeignKey("catalog_columns.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    references_table = Column(String, nullable=False)
    references_column = Column(String, nullable=False)

    column = relationship("CatalogColumn", back_populates="foreign_keys_rel")
