"""Semantic / Metrics Layer models (DP-SEM-001).

Tables:
    semantic_entities       — business entities (e.g., "Customer", "Order").
    semantic_dimensions     — grouping/filtering attributes (e.g., "customer_id",
                             "order_date"). Scoped to an entity.
    semantic_measures       — aggregation targets (e.g., "revenue", "count").
                             Scoped to an entity.
    semantic_metrics        — versioned metric definitions (e.g.,
                             "monthly_revenue"). Each metric composes measures,
                             dimensions, filters, joins, and time_grain. The
                             definition body is JSON; shape is validated by
                             semantic_definition.py (Task #4).
    semantic_lineage       — lineage records linking a semantic element to
                             a physical schema object (Schema Intel's
                             catalog_columns table).

Versioning + draft/published: every metric has version_number and status
(draft | published). Published versions are immutable (Task #2 enforces).
Certification is a flag (FR8) so consumers can distinguish approved
metrics from experimental ones.

Foreign-key strategy: catalog_columns.id (the Schema Intel catalog) is
the target of semantic_lineage; lineage rows are deleted when the
underlying catalog column is dropped.
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, JSON,
    UniqueConstraint, Index, Boolean,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


# ── Business entities ───────────────────────────────────────────────


class SemanticEntity(Base):
    __tablename__ = "semantic_entities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    owner = Column(String, nullable=True)
    created_by = Column(String, nullable=False, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    dimensions = relationship(
        "SemanticDimension", back_populates="entity", cascade="all, delete-orphan",
    )
    measures = relationship(
        "SemanticMeasure", back_populates="entity", cascade="all, delete-orphan",
    )


# ── Dimensions + measures (per entity) ─────────────────────────────


class SemanticDimension(Base):
    __tablename__ = "semantic_dimensions"
    __table_args__ = (
        UniqueConstraint("entity_id", "name", name="uq_semantic_dimension_per_entity"),
    )

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(
        Integer, ForeignKey("semantic_entities.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # Type hint for the UI: "categorical", "ordinal", "temporal", "geographic".
    # The resolution engine (Task #6) treats "temporal" as the only kind
    # that's eligible for time_grain. Free-form for now; tighten once
    # Task #6 designs the language.
    semantic_type = Column(String, nullable=False, default="categorical")
    # Physical mapping (Task #4). Nullable so a dimension can exist as a
    # pure logical definition before it's bound to a column. The catalog
    # column is the Schema Intel anchor that the resolution engine walks
    # through when generating SQL.
    catalog_column_id = Column(
        Integer,
        ForeignKey("catalog_columns.id", ondelete="SET NULL"),
        nullable=True,
    )

    entity = relationship("SemanticEntity", back_populates="dimensions")
    catalog_column_rel = relationship("CatalogColumn", foreign_keys=[catalog_column_id])


class SemanticMeasure(Base):
    __tablename__ = "semantic_measures"
    __table_args__ = (
        UniqueConstraint("entity_id", "name", name="uq_semantic_measure_per_entity"),
    )

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(
        Integer, ForeignKey("semantic_entities.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # Aggregation function: "sum", "count", "count_distinct", "avg",
    # "min", "max". Free-form string; the resolution engine (Task #6)
    # is the authoritative validator. Stored as a string (not an enum)
    # so adding a new aggregation doesn't require a schema migration.
    default_aggregation = Column(String, nullable=False, default="sum")
    # Physical mapping (Task #4). Nullable so a measure can exist as a
    # pure logical definition before it's bound to a column.
    catalog_column_id = Column(
        Integer,
        ForeignKey("catalog_columns.id", ondelete="SET NULL"),
        nullable=True,
    )

    entity = relationship("SemanticEntity", back_populates="measures")
    catalog_column_rel = relationship("CatalogColumn", foreign_keys=[catalog_column_id])


# ── MetricDefinition (versioned) ──────────────────────────────────


class SemanticMetricDefinition(Base):
    """Versioned metric definition.

    Each `(name, version_number)` pair is unique. A metric's logical
    identity is its `name`; `version_number` increments per published
    version. Status is one of:
      - draft:      editable, not visible to consumers
      - published:  immutable, visible to consumers (Task #2 enforces)
      - archived:   hidden from consumers, kept for history
    """

    __tablename__ = "semantic_metric_definitions"
    __table_args__ = (
        UniqueConstraint("name", "version_number",
                         name="uq_semantic_metric_name_version"),
        Index("ix_semantic_metric_status", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Logical identity of the metric across versions.
    name = Column(String, nullable=False)
    version_number = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="draft")
    # The metric definition body (Task #4 designs the JSON shape).
    # Examples:
    #   {"aggregation":"sum","measure":"amount","entity":"orders",
    #    "filters":[...],"joins":[...],"time_grain":"month",
    #    "time_column":"order_date"}
    # Stored as JSON; shape validation lives in semantic_definition.py.
    definition = Column(JSON, nullable=False, default=dict)
    # Human-readable description surfaced in the catalog.
    description = Column(Text, nullable=True)
    # FR8: certified badges distinguish approved metrics from experimental.
    certified = Column(Integer, nullable=False, default=0)  # 1=true, 0=false
    # Owning team / individual (audit provenance).
    owner = Column(String, nullable=True)
    created_by = Column(String, nullable=False, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    # Publish bookkeeping. Published versions are immutable; Task #2
    # enforces this in the service layer.
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(String, nullable=True)

    lineage = relationship(
        "SemanticLineage", back_populates="metric",
        cascade="all, delete-orphan",
    )


# ── Lineage (semantic -> physical) ────────────────────────────────


class SemanticLineage(Base):
    """A lineage record says: a given semantic metric (versioned) reads
    from a specific physical catalog column.

    Lets the catalog UI render lineage (FR4: "lineage to source columns")
    and lets the resolution engine (Task #6) resolve a definition to
    physical SQL by walking semantic → physical references.
    """

    __tablename__ = "semantic_lineage"
    __table_args__ = (
        Index("ix_semantic_lineage_metric", "metric_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    metric_id = Column(
        Integer, ForeignKey("semantic_metric_definitions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The physical column the metric reads from. FK to Schema Intel's
    # catalog table. ondelete=SET NULL so lineage rows survive when the
    # physical column is dropped (the lineage becomes "broken" but the
    # historical record is preserved for audit).
    catalog_column_id = Column(
        Integer,
        ForeignKey("catalog_columns.id", ondelete="SET NULL"),
        nullable=True,
    )
    # What role this column plays: "measure", "dimension", "time", or
    # "join_key". The resolution engine reads this to know how to plug
    # the column into the generated query.
    role = Column(String, nullable=False, default="measure")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    metric = relationship("SemanticMetricDefinition", back_populates="lineage")
