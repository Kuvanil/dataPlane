"""Semantic / Metrics Layer service (DP-SEM-001).

Implements the CRUD + versioning surface for the entities, dimensions,
measures, and metric definitions persisted in app/models/semantic.py.

Tasks covered:
- #1 (SEM-T4 partial): versioning + draft/published transitions +
  immutability of published versions. The MetricDefinition model already
  has version_number, status, published_at, published_by columns; this
  module enforces the state machine and the immutability invariant.

- #3 (SEM-T9): audit emission via record_audit on every state change.

The definition language (Task #3 in this cycle) is NOT enforced here
yet; for now the `definition` JSON is stored as-is and Task #3 will
add grammar validation when it's implemented.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.schema_catalog import CatalogColumn
from app.models.semantic import (
    SemanticDimension,
    SemanticEntity,
    SemanticLineage,
    SemanticMeasure,
    SemanticMetricDefinition,
)
from app.services.audit_helper import record_audit

logger = logging.getLogger(__name__)


class SemanticCRUD:
    """Static-method facade for the semantic layer.

    Mirrors the PipelineCRUD / MappingCRUD pattern: every mutating
    method emits a record_audit row with the right actor / before /
    after payload. The legacy Visual Transformation Studio pattern
    (single class with static methods, no DI) is preserved for
    consistency with the rest of this codebase.
    """

    # ── Entities ─────────────────────────────────────────────────

    @staticmethod
    def create_entity(
        db: Session,
        *,
        name: str,
        description: Optional[str] = None,
        owner: Optional[str] = None,
        actor: str,
    ) -> SemanticEntity:
        if db.query(SemanticEntity).filter(SemanticEntity.name == name).first():
            raise HTTPException(
                status_code=409, detail=f"entity '{name}' already exists",
            )
        e = SemanticEntity(name=name, description=description, owner=owner,
                           created_by=actor)
        db.add(e)
        db.flush()
        record_audit(
            db, "semantic_entity_created", actor=actor,
            payload={"entity_id": e.id, "name": name, "owner": owner},
        )
        db.commit()
        db.refresh(e)
        return e

    @staticmethod
    def list_entities(db: Session) -> List[SemanticEntity]:
        return db.query(SemanticEntity).order_by(SemanticEntity.name).all()

    # ── Dimensions ─────────────────────────────────────────────

    @staticmethod
    def create_dimension(
        db: Session,
        *,
        entity_id: int,
        name: str,
        semantic_type: str = "categorical",
        description: Optional[str] = None,
        actor: str = "system",
    ) -> SemanticDimension:
        # Verify the entity exists (404 is clearer than a FK violation).
        if not db.query(SemanticEntity).filter(SemanticEntity.id == entity_id).first():
            raise HTTPException(
                status_code=404, detail=f"entity {entity_id} not found",
            )
        d = SemanticDimension(
            entity_id=entity_id, name=name,
            semantic_type=semantic_type, description=description,
        )
        db.add(d)
        db.flush()
        record_audit(
            db, "semantic_dimension_created", actor=actor,
            payload={
                "dimension_id": d.id, "entity_id": entity_id, "name": name,
                "semantic_type": semantic_type,
            },
        )
        db.commit()
        db.refresh(d)
        return d

    # ── Measures ───────────────────────────────────────────────

    @staticmethod
    def create_measure(
        db: Session,
        *,
        entity_id: int,
        name: str,
        default_aggregation: str = "sum",
        description: Optional[str] = None,
        actor: str = "system",
    ) -> SemanticMeasure:
        if not db.query(SemanticEntity).filter(SemanticEntity.id == entity_id).first():
            raise HTTPException(
                status_code=404, detail=f"entity {entity_id} not found",
            )
        m = SemanticMeasure(
            entity_id=entity_id, name=name,
            default_aggregation=default_aggregation, description=description,
        )
        db.add(m)
        db.flush()
        record_audit(
            db, "semantic_measure_created", actor=actor,
            payload={
                "measure_id": m.id, "entity_id": entity_id, "name": name,
                "default_aggregation": default_aggregation,
            },
        )
        db.commit()
        db.refresh(m)
        return m

    # ── Metric definitions (SEM-T4 versioning) ───────────────────

    @staticmethod
    def _next_version_number(db: Session, name: str) -> int:
        latest = (
            db.query(SemanticMetricDefinition)
            .filter(SemanticMetricDefinition.name == name)
            .order_by(SemanticMetricDefinition.version_number.desc())
            .first()
        )
        return (latest.version_number + 1) if latest else 1

    @staticmethod
    def create_metric_draft(
        db: Session,
        *,
        name: str,
        definition: Dict[str, Any],
        description: Optional[str] = None,
        certified: bool = False,
        owner: Optional[str] = None,
        actor: str,
    ) -> SemanticMetricDefinition:
        """Create the first draft (version 1) of a new metric. Fails 409
        if a metric with this name already exists in any state — to
        iterate on an existing draft, use save_draft on its current
        draft row; to release a new version, use publish."""
        if db.query(SemanticMetricDefinition).filter(
            SemanticMetricDefinition.name == name,
        ).first():
            raise HTTPException(
                status_code=409,
                detail=(
                    f"metric '{name}' already exists; use save_draft on "
                    f"its current draft or publish for a new version"
                ),
            )
        m = SemanticMetricDefinition(
            name=name,
            version_number=1,
            status="draft",
            definition=definition,
            description=description,
            certified=1 if certified else 0,
            owner=owner,
            created_by=actor,
        )
        db.add(m)
        db.flush()
        record_audit(
            db, "semantic_metric_created", actor=actor,
            payload={
                "metric_id": m.id, "name": name, "version": 1,
                "certified": bool(certified),
            },
        )
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def save_draft(
        db: Session,
        metric_id: int,
        *,
        definition: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None,
        certified: Optional[bool] = None,
        owner: Optional[str] = None,
        actor: str,
    ) -> SemanticMetricDefinition:
        """Update a draft metric. Published / archived versions are
        immutable — this method enforces that."""
        m = SemanticCRUD.get_metric(db, metric_id)
        if m.status != "draft":
            raise HTTPException(
                status_code=409,
                detail=(
                    f"metric {m.name} v{m.version_number} is '{m.status}'; "
                    f"only drafts can be edited (publish a new version "
                    f"instead)"
                ),
            )
        before = {
            "definition": m.definition, "description": m.description,
            "certified": bool(m.certified), "owner": m.owner,
        }
        if definition is not None:
            m.definition = definition
        if description is not None:
            m.description = description
        if certified is not None:
            m.certified = 1 if certified else 0
        if owner is not None:
            m.owner = owner
        db.flush()
        record_audit(
            db, "semantic_metric_updated", actor=actor,
            payload={
                "metric_id": m.id, "name": m.name, "version": m.version_number,
                "before": before,
                "after": {
                    "definition": m.definition,
                    "description": m.description,
                    "certified": bool(m.certified),
                    "owner": m.owner,
                },
            },
        )
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def publish(
        db: Session,
        metric_id: int,
        *,
        actor: str,
    ) -> SemanticMetricDefinition:
        """Publish the current draft of a metric as a new immutable
        version. The published draft is not modified; we create a new
        row at version_number+1 with status=published and the same
        lineage copied from the draft. The previous version (if any)
        stays at whatever status it had.
        """
        draft = SemanticCRUD.get_metric(db, metric_id)
        if draft.status != "draft":
            raise HTTPException(
                status_code=409,
                detail=(
                    f"metric {draft.name} v{draft.version_number} is "
                    f"'{draft.status}'; only drafts can be published"
                ),
            )
        next_n = SemanticCRUD._next_version_number(db, draft.name)
        published = SemanticMetricDefinition(
            name=draft.name,
            version_number=next_n,
            status="published",
            definition=draft.definition,
            description=draft.description,
            certified=draft.certified,
            owner=draft.owner,
            created_by=draft.created_by,
            published_at=__import__("datetime").datetime.now(
                __import__("datetime").timezone.utc,
            ),
            published_by=actor,
        )
        db.add(published)
        db.flush()
        # Copy lineage rows from the draft to the new published version.
        for ln in (draft.lineage or []):
            db.add(SemanticLineage(
                metric_id=published.id,
                catalog_column_id=ln.catalog_column_id,
                role=ln.role,
            ))
        record_audit(
            db, "semantic_metric_published", actor=actor,
            payload={
                "metric_id": published.id, "name": published.name,
                "version": next_n, "from_draft_id": draft.id,
            },
        )
        db.commit()
        db.refresh(published)
        return published

    @staticmethod
    def archive(
        db: Session,
        metric_id: int,
        *,
        actor: str,
    ) -> SemanticMetricDefinition:
        """Archive a published version. Archived versions are hidden from
        the catalog (FR4 search filter) but kept for history. The
        definition is still immutable — archiving only flips status."""
        m = SemanticCRUD.get_metric(db, metric_id)
        if m.status == "draft":
            raise HTTPException(
                status_code=409,
                detail="draft metrics cannot be archived; delete instead",
            )
        if m.status == "archived":
            return m  # idempotent
        before = {"status": m.status}
        m.status = "archived"
        db.flush()
        record_audit(
            db, "semantic_metric_archived", actor=actor,
            payload={
                "metric_id": m.id, "name": m.name, "version": m.version_number,
                "before": before, "after": {"status": m.status},
            },
        )
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def get_metric(db: Session, metric_id: int) -> SemanticMetricDefinition:
        m = (
            db.query(SemanticMetricDefinition)
            .filter(SemanticMetricDefinition.id == metric_id)
            .first()
        )
        if not m:
            raise HTTPException(status_code=404, detail="metric not found")
        return m

    @staticmethod
    def list_metric_versions(
        db: Session, name: str,
    ) -> List[SemanticMetricDefinition]:
        return (
            db.query(SemanticMetricDefinition)
            .filter(SemanticMetricDefinition.name == name)
            .order_by(SemanticMetricDefinition.version_number.desc())
            .all()
        )

    @staticmethod
    def list_metrics(
        db: Session,
        *,
        only_published: bool = False,
        only_certified: Optional[bool] = None,
        search: Optional[str] = None,
    ) -> List[SemanticMetricDefinition]:
        """Catalog listing (FR4 / SEM-T5). Search matches name OR
        description (case-insensitive). only_certified filters to metrics
        with certified=1. only_published excludes drafts from the catalog.
        """
        q = db.query(SemanticMetricDefinition)
        if only_published:
            q = q.filter(SemanticMetricDefinition.status == "published")
        if only_certified is True:
            q = q.filter(SemanticMetricDefinition.certified == 1)
        if only_certified is False:
            q = q.filter(SemanticMetricDefinition.certified == 0)
        if search:
            pat = f"%{search.lower()}%"
            from sqlalchemy import func, or_
            q = q.filter(or_(
                func.lower(SemanticMetricDefinition.name).like(pat),
                func.lower(func.coalesce(
                    SemanticMetricDefinition.description, "")).like(pat),
            ))
        return q.order_by(
            SemanticMetricDefinition.name, SemanticMetricDefinition.version_number.desc(),
        ).all()

    # ── Lineage ─────────────────────────────────────────────────

    @staticmethod
    def add_lineage(
        db: Session,
        *,
        metric_id: int,
        catalog_column_id: int,
        role: str = "measure",
        actor: str = "system",
    ) -> SemanticLineage:
        # Verify both sides exist so the 4xx is clear, not a DB FK error.
        m = SemanticCRUD.get_metric(db, metric_id)
        col = (
            db.query(CatalogColumn)
            .filter(CatalogColumn.id == catalog_column_id)
            .first()
        )
        if not col:
            raise HTTPException(
                status_code=404,
                detail=f"catalog column {catalog_column_id} not found",
            )
        ln = SemanticLineage(
            metric_id=metric_id, catalog_column_id=catalog_column_id, role=role,
        )
        db.add(ln)
        db.flush()
        record_audit(
            db, "semantic_lineage_added", actor=actor,
            payload={
                "lineage_id": ln.id, "metric_id": metric_id,
                "catalog_column_id": catalog_column_id, "role": role,
            },
        )
        db.commit()
        db.refresh(ln)
        return ln
