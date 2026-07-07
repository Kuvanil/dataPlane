"""Mapping workspace models (Schema Mapper upgrade).

Tables:
    mappings            — top-level draft / published mapping workspace.
    mapping_versions    — immutable per-version snapshots of a published mapping.
    field_mappings      — field-level edges (1..N sources → 1 target) per mapping.
    ai_suggestions      — AI-generated match candidates awaiting accept/reject.
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, JSON,
    UniqueConstraint, Float, Index, text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Mapping(Base):
    __tablename__ = "mappings"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    target_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft | published
    current_version_id = Column(
        Integer,
        ForeignKey("mapping_versions.id", ondelete="SET NULL", use_alter=True,
                   name="fk_mappings_current_version"),
        nullable=True,
    )
    created_by = Column(String, nullable=False, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    # Use string-based foreign_keys to avoid load-order issues between
    # Mapping and MappingVersion (the latter references Mapping.id).
    versions = relationship(
        "MappingVersion",
        back_populates="mapping",
        foreign_keys="MappingVersion.mapping_id",
        cascade="all, delete-orphan",
    )
    current_version = relationship(
        "MappingVersion",
        foreign_keys=[current_version_id],
        post_update=True,
    )
    edges = relationship(
        "FieldMapping",
        back_populates="mapping",
        cascade="all, delete-orphan",
        foreign_keys="FieldMapping.mapping_id",
    )
    suggestions = relationship(
        "AISuggestion",
        back_populates="mapping",
        cascade="all, delete-orphan",
    )


class MappingVersion(Base):
    __tablename__ = "mapping_versions"
    __table_args__ = (
        UniqueConstraint("mapping_id", "version_number", name="uq_mapping_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="draft")  # draft | published | archived
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(String, nullable=True)
    schema_snapshot = Column(JSON, nullable=True)
    edges_snapshot = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mapping = relationship(
        "Mapping",
        back_populates="versions",
        foreign_keys=[mapping_id],
    )


class FieldMapping(Base):
    __tablename__ = "field_mappings"
    __table_args__ = (
        UniqueConstraint("version_id", "target_table", "target_column",
                         name="uq_field_target_per_version"),
        # uq_field_target_per_version does NOT cover drafts: their
        # version_id is NULL, and SQL unique constraints treat NULLs as
        # distinct, so any number of draft edges could share a target. This
        # partial unique index is the DB backstop for the service-level
        # _check_target_not_mapped guard, which is check-then-insert and
        # therefore racy under concurrency (review_schema_mapper_round2
        # #11). NOTE: no migration tooling in this repo — create_all only
        # creates it on fresh databases; existing deployments need a manual
        # CREATE UNIQUE INDEX with the same WHERE clause.
        Index(
            "uq_field_target_per_draft",
            "mapping_id", "target_table", "target_column",
            unique=True,
            sqlite_where=text("version_id IS NULL"),
            postgresql_where=text("version_id IS NULL"),
        ),
        Index("ix_field_mapping_mapping", "mapping_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"),
                        nullable=False)
    version_id = Column(Integer, ForeignKey("mapping_versions.id", ondelete="CASCADE"),
                        nullable=True)
    target_table = Column(String, nullable=False)
    target_column = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    # 1 = nullable, 0 = not null, NULL = unknown — kept as int for SQLite portability
    target_nullable = Column(Integer, nullable=True)
    target_is_pk = Column(Integer, nullable=True)
    sources = Column(JSON, nullable=False, default=list)  # [{table,column,type}, ...]
    transformation = Column(JSON, nullable=False, default=dict)
    origin = Column(String, nullable=False, default="manual")  # manual | ai_accepted | english_parsed
    ai_confidence = Column(Float, nullable=True)
    audit = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    mapping = relationship(
        "Mapping",
        back_populates="edges",
        foreign_keys=[mapping_id],
    )


class AISuggestion(Base):
    __tablename__ = "ai_suggestions"
    __table_args__ = (
        Index("ix_ai_suggestion_mapping_status", "mapping_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"),
                        nullable=False)
    target_table = Column(String, nullable=False)
    target_column = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    source_table = Column(String, nullable=False)
    source_column = Column(String, nullable=False)
    source_type = Column(String, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    reason = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | accepted | rejected
    accepted_edge_id = Column(Integer, ForeignKey("field_mappings.id", ondelete="SET NULL"),
                              nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decided_by = Column(String, nullable=True)

    mapping = relationship("Mapping", back_populates="suggestions")
