"""Mapping workspace service: CRUD, draft/publish state machine, audit emission."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.models.connection import DBConnection
from app.models.mapping import (
    AISuggestion, FieldMapping, Mapping, MappingVersion,
)
from app.services.audit_helper import record_audit
from app.services.mapping_validation_service import MappingValidationService
from app.services.transformation_grammar import GrammarError, parse
# Importing the task object directly (instead of send_task by string name)
# means a future rename or typo fails at import time, not silently at runtime
# (review §11.1).
from app.workers.mapping_tasks import suggest_mappings_task

logger = logging.getLogger(__name__)


class MappingService:

    # ── Mapping lifecycle ──────────────────────────────────────

    @staticmethod
    def create_mapping(db: Session, *, source_id: int, target_id: int,
                       name: str, actor: str) -> Mapping:
        for cid, label in ((source_id, "source"), (target_id, "target")):
            if not db.query(DBConnection).filter(DBConnection.id == cid).first():
                raise HTTPException(
                    status_code=404, detail=f"{label} connection {cid} not found",
                )
        if source_id == target_id:
            raise HTTPException(
                status_code=422, detail="source and target must be different",
            )
        m = Mapping(
            name=name, source_id=source_id, target_id=target_id,
            status="draft", created_by=actor,
        )
        db.add(m)
        db.flush()
        record_audit(
            db, "mapping_created", actor=actor,
            connection_id=source_id,
            payload={
                "mapping_id": m.id, "name": name,
                "source_id": source_id, "target_id": target_id,
            },
        )
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def get_mapping(db: Session, mapping_id: int) -> Mapping:
        m = (
            db.query(Mapping)
            .filter(Mapping.id == mapping_id, Mapping.deleted_at.is_(None))
            .first()
        )
        if not m:
            raise HTTPException(status_code=404, detail="mapping not found")
        return m

    @staticmethod
    def update_mapping_meta(db: Session, mapping_id: int, *,
                            name: Optional[str], actor: str) -> Mapping:
        m = MappingService.get_mapping(db, mapping_id)
        before = {"name": m.name}
        if name:
            m.name = name
        db.flush()
        record_audit(
            db, "mapping_meta_updated", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id,
                "before": before,
                "after": {"name": m.name},
            },
        )
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def delete_mapping(db: Session, mapping_id: int, *, actor: str) -> None:
        m = MappingService.get_mapping(db, mapping_id)
        if m.status == "published":
            raise HTTPException(
                status_code=409,
                detail="published mappings cannot be deleted; archive instead",
            )
        m.deleted_at = datetime.now(timezone.utc)
        db.flush()
        record_audit(
            db, "mapping_deleted", actor=actor,
            connection_id=m.source_id,
            payload={"mapping_id": m.id, "name": m.name},
        )
        db.commit()

    # ── Edge operations ───────────────────────────────────────

    @staticmethod
    def add_edge(db: Session, mapping_id: int, *,
                 target: Dict[str, Any], sources: List[Dict[str, Any]],
                 transformation: Dict[str, Any], origin: str = "manual",
                 actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)

        if not sources:
            raise HTTPException(
                status_code=422, detail="at least one source column is required",
            )

        # FR3: enforce 1:1 / N:1.
        # For each candidate source column, check whether it is already mapped
        # to a DIFFERENT target column within this mapping's draft.
        target_key = (target["table"], target["column"])
        existing = (
            db.query(FieldMapping)
            .filter(FieldMapping.mapping_id == mapping_id,
                    FieldMapping.version_id.is_(None))
            .all()
        )
        for src in sources:
            src_key = (src["table"], src["column"])
            for e in existing:
                e_target_key = (e.target_table, e.target_column)
                for es in (e.sources or []):
                    if (es.get("table"), es.get("column")) == src_key and e_target_key != target_key:
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                f"source {src_key} already mapped to "
                                f"{e_target_key}; many-to-many is not supported"
                            ),
                        )

        try:
            parse(transformation or {"kind": "direct"})
        except GrammarError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "kind": "grammar_error",
                    "message": exc.to_dict()["message"],
                    "location": exc.to_dict()["location"],
                },
            ) from exc

        now = datetime.now(timezone.utc).isoformat()
        audit = {
            "created_by": actor, "created_at": now,
            "updated_by": actor, "updated_at": now,
        }
        edge = FieldMapping(
            mapping_id=m.id,
            version_id=None,
            target_table=target["table"],
            target_column=target["column"],
            target_type=target.get("type"),
            target_nullable=(
                1 if target.get("nullable")
                else (0 if target.get("nullable") is False else None)
            ),
            target_is_pk=1 if target.get("primary_key") else 0,
            sources=sources,
            transformation=transformation or {"kind": "direct"},
            origin=origin,
            audit=audit,
        )
        db.add(edge)
        db.flush()
        record_audit(
            db, "mapping_edge_added", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "edge_id": edge.id,
                "target": target, "sources": sources,
                "origin": origin,
            },
        )
        db.commit()
        db.refresh(edge)
        return edge

    @staticmethod
    def remove_edge(db: Session, mapping_id: int, edge_id: int, *,
                    actor: str) -> None:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        edge = (
            db.query(FieldMapping)
            .filter(
                FieldMapping.id == edge_id,
                FieldMapping.mapping_id == mapping_id,
            )
            .first()
        )
        if not edge:
            raise HTTPException(status_code=404, detail="edge not found")
        before = {"target": f"{edge.target_table}.{edge.target_column}"}
        db.delete(edge)
        db.flush()
        record_audit(
            db, "mapping_edge_removed", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "edge_id": edge_id, "before": before,
            },
        )
        db.commit()

    @staticmethod
    def update_edge_transformation(db: Session, mapping_id: int, edge_id: int,
                                   transformation: Dict[str, Any], *,
                                   actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        edge = (
            db.query(FieldMapping)
            .filter(
                FieldMapping.id == edge_id,
                FieldMapping.mapping_id == mapping_id,
            )
            .first()
        )
        if not edge:
            raise HTTPException(status_code=404, detail="edge not found")
        try:
            parse(transformation or {"kind": "direct"})
        except GrammarError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "kind": "grammar_error",
                    "message": exc.to_dict()["message"],
                    "location": exc.to_dict()["location"],
                },
            ) from exc
        before = dict(edge.transformation or {})
        edge.transformation = transformation or {"kind": "direct"}
        now = datetime.now(timezone.utc).isoformat()
        edge.audit = {
            **(edge.audit or {}),
            "updated_by": actor, "updated_at": now,
        }
        db.flush()
        record_audit(
            db, "mapping_edge_updated", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "edge_id": edge_id,
                "before": before, "after": edge.transformation,
            },
        )
        db.commit()
        db.refresh(edge)
        return edge

    # ── AI suggestions ────────────────────────────────────────

    @staticmethod
    def request_suggestions(db: Session, mapping_id: int, *,
                            actor: str) -> str:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        task = suggest_mappings_task.delay(mapping_id=mapping_id)
        record_audit(
            db, "mapping_suggestions_requested", actor=actor,
            connection_id=m.source_id,
            payload={"mapping_id": m.id, "task_id": task.id},
        )
        db.commit()
        return task.id

    @staticmethod
    def accept_suggestion(db: Session, mapping_id: int, suggestion_id: int,
                          transformation: Optional[Dict[str, Any]],
                          *, actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        sug = (
            db.query(AISuggestion)
            .filter(
                AISuggestion.id == suggestion_id,
                AISuggestion.mapping_id == mapping_id,
            )
            .first()
        )
        if not sug:
            raise HTTPException(status_code=404, detail="suggestion not found")
        if sug.status != "pending":
            raise HTTPException(
                status_code=409, detail=f"suggestion already {sug.status}",
            )

        # Skip the N:N guard since suggestion sources are unique to this target.
        edge = MappingService._add_edge_internal(
            db, m,
            target={
                "table": sug.target_table, "column": sug.target_column,
                "type": sug.target_type,
            },
            sources=[{
                "table": sug.source_table, "column": sug.source_column,
                "type": sug.source_type,
            }],
            transformation=transformation or {"kind": "direct"},
            origin="ai_accepted",
            actor=actor,
        )
        # Normalize ai_confidence to the contract's 0.0-1.0 scale.
        # AISuggestion.confidence is 0-100 (matches the percentage UI shows);
        # the exported artifact and the contract doc use the 0-1 fraction.
        edge.ai_confidence = (
            sug.confidence / 100.0 if sug.confidence > 1 else sug.confidence
        )
        sug.status = "accepted"
        sug.accepted_edge_id = edge.id
        sug.decided_at = datetime.now(timezone.utc)
        sug.decided_by = actor
        db.flush()
        record_audit(
            db, "ai_suggestion_accepted", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "suggestion_id": sug.id,
                "edge_id": edge.id, "confidence": sug.confidence,
            },
        )
        db.commit()
        db.refresh(edge)
        return edge

    @staticmethod
    def reject_suggestion(db: Session, mapping_id: int, suggestion_id: int,
                          *, actor: str) -> AISuggestion:
        m = MappingService.get_mapping(db, mapping_id)
        sug = (
            db.query(AISuggestion)
            .filter(
                AISuggestion.id == suggestion_id,
                AISuggestion.mapping_id == mapping_id,
            )
            .first()
        )
        if not sug:
            raise HTTPException(status_code=404, detail="suggestion not found")
        if sug.status != "pending":
            raise HTTPException(
                status_code=409, detail=f"suggestion already {sug.status}",
            )
        sug.status = "rejected"
        sug.decided_at = datetime.now(timezone.utc)
        sug.decided_by = actor
        db.flush()
        record_audit(
            db, "ai_suggestion_rejected", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "suggestion_id": sug.id,
                "confidence": sug.confidence,
            },
        )
        db.commit()
        db.refresh(sug)
        return sug

    # ── Validation ────────────────────────────────────────────

    @staticmethod
    def validate(db: Session, mapping_id: int, *, actor: str) -> Dict[str, Any]:
        m = MappingService.get_mapping(db, mapping_id)
        summary = MappingValidationService.validate_mapping(m)
        record_audit(
            db, "mapping_validated", actor=actor,
            connection_id=m.source_id,
            payload={"mapping_id": m.id, **summary},
        )
        db.commit()
        return summary

    # ── Publish + export ──────────────────────────────────────

    @staticmethod
    def publish(db: Session, mapping_id: int, *, actor: str) -> MappingVersion:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        summary = MappingValidationService.validate_mapping(m)
        if summary["blocking_count"] > 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "kind": "validation_blocking",
                    "blocking_count": summary["blocking_count"],
                    "issues": summary["issues"],
                },
            )

        from app.services.schema_service import SchemaService
        source_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        )
        target_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.target_id).first()
        )
        try:
            source_schema = SchemaService.get_full_schema(source_conn)
            target_schema = SchemaService.get_full_schema(target_conn)
        except Exception as exc:
            logger.warning("publish: schema fetch failed for mapping %s: %s", m.id, exc)
            raise HTTPException(
                status_code=500,
                detail=f"schema snapshot failed: {exc}",
            ) from exc

        last = (
            db.query(MappingVersion)
            .filter(MappingVersion.mapping_id == m.id)
            .order_by(MappingVersion.version_number.desc())
            .first()
        )
        next_n = (last.version_number + 1) if last else 1

        edges_snapshot = [_edge_to_dict(e) for e in (m.edges or [])]

        version = MappingVersion(
            mapping_id=m.id,
            version_number=next_n,
            status="published",
            published_at=datetime.now(timezone.utc),
            published_by=actor,
            schema_snapshot={"source": source_schema, "target": target_schema},
            edges_snapshot=edges_snapshot,
        )
        db.add(version)
        db.flush()

        # Pin all current draft edges to this version.
        for e in (m.edges or []):
            e.version_id = version.id
        m.status = "published"
        m.current_version_id = version.id
        db.flush()
        record_audit(
            db, "mapping_published", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id,
                "version_number": next_n,
                "version_id": version.id,
                "edges_count": len(edges_snapshot),
            },
        )
        db.commit()
        db.refresh(version)
        return version

    @staticmethod
    def export_json(db: Session, mapping_id: int, *, actor: str,
                    version_id: Optional[int] = None) -> Dict[str, Any]:
        m = MappingService.get_mapping(db, mapping_id)
        if version_id is not None:
            v = (
                db.query(MappingVersion)
                .filter(
                    MappingVersion.id == version_id,
                    MappingVersion.mapping_id == m.id,
                )
                .first()
            )
            if v is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"version {version_id} not found for mapping {m.id}",
                )
        else:
            v = m.current_version
        if v is None:
            raise HTTPException(
                status_code=409, detail="no published version to export",
            )
        if v.status != "published":
            raise HTTPException(
                status_code=409,
                detail=f"version {v.id} is not published",
            )

        source_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        )
        target_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.target_id).first()
        )

        artifact = {
            "mapping_id": m.id,
            "name": m.name,
            "version": v.version_number,
            "status": "published",
            "published_at": v.published_at.isoformat() if v.published_at else None,
            "published_by": v.published_by,
            "source": {
                "connection_id": source_conn.id if source_conn else None,
                "name": source_conn.name if source_conn else None,
                "type": source_conn.type if source_conn else None,
            },
            "target": {
                "connection_id": target_conn.id if target_conn else None,
                "name": target_conn.name if target_conn else None,
                "type": target_conn.type if target_conn else None,
            },
            "field_mappings": v.edges_snapshot or [],
            "schema_snapshot": v.schema_snapshot or {},
        }
        record_audit(
            db, "mapping_exported", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "version_id": v.id,
                "version_number": v.version_number,
            },
        )
        db.commit()
        return artifact

    # ── Internals ─────────────────────────────────────────────

    @staticmethod
    def _add_edge_internal(db: Session, m: Mapping, *,
                           target: Dict[str, Any],
                           sources: List[Dict[str, Any]],
                           transformation: Dict[str, Any],
                           origin: str, actor: str) -> FieldMapping:
        """Add an edge without the many-to-many guard (used by suggestion accept)."""
        try:
            parse(transformation or {"kind": "direct"})
        except GrammarError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "kind": "grammar_error",
                    "message": exc.to_dict()["message"],
                    "location": exc.to_dict()["location"],
                },
            ) from exc
        now = datetime.now(timezone.utc).isoformat()
        audit = {
            "created_by": actor, "created_at": now,
            "updated_by": actor, "updated_at": now,
        }
        edge = FieldMapping(
            mapping_id=m.id,
            version_id=None,
            target_table=target["table"],
            target_column=target["column"],
            target_type=target.get("type"),
            target_nullable=(
                1 if target.get("nullable")
                else (0 if target.get("nullable") is False else None)
            ),
            target_is_pk=1 if target.get("primary_key") else 0,
            sources=sources,
            transformation=transformation or {"kind": "direct"},
            origin=origin,
            audit=audit,
        )
        db.add(edge)
        db.flush()
        record_audit(
            db, "mapping_edge_added", actor=actor,
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id, "edge_id": edge.id,
                "target": target, "sources": sources, "origin": origin,
            },
        )
        db.refresh(edge)
        return edge


def _assert_draft(m: Mapping) -> None:
    if m.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=(
                f"mapping {m.id} is '{m.status}'; "
                "only draft mappings are mutable"
            ),
        )


def _edge_to_dict(edge: FieldMapping) -> Dict[str, Any]:
    return {
        "id": edge.id,
        "origin": edge.origin,
        "ai_confidence": edge.ai_confidence,
        "target": {
            "table": edge.target_table,
            "column": edge.target_column,
            "type": edge.target_type,
            "nullable": (
                bool(edge.target_nullable)
                if edge.target_nullable is not None else None
            ),
            "primary_key": bool(edge.target_is_pk),
        },
        "sources": list(edge.sources or []),
        "transformation": edge.transformation or {"kind": "direct"},
        "audit": edge.audit or {},
    }
