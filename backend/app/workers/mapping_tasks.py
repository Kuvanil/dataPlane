"""Celery task for AI mapping suggestions (Schema Mapper upgrade)."""
from __future__ import annotations

import logging
from typing import Any, Dict

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.models.mapping import AISuggestion, Mapping
from app.services.ai_service import AIService
from app.services.audit_helper import record_audit
from app.services.schema_service import SchemaService

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.workers.mapping_tasks.suggest_mappings_task",
    bind=True,
)
def suggest_mappings_task(self, mapping_id: int) -> Dict[str, Any]:
    """Walk unmapped target columns and create AI suggestions for each."""
    db = SessionLocal()
    try:
        m = db.query(Mapping).filter(Mapping.id == mapping_id).first()
        if not m:
            return {"status": "failed", "error": "mapping not found"}

        source_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        )
        target_conn = (
            db.query(DBConnection).filter(DBConnection.id == m.target_id).first()
        )
        if not source_conn or not target_conn:
            return {"status": "failed", "error": "connection not found"}

        try:
            source_schema = SchemaService.get_full_schema(source_conn)
            target_schema = SchemaService.get_full_schema(target_conn)
        except Exception as exc:
            logger.warning(
                "suggest_mappings_task: schema fetch failed for mapping %s: %s",
                mapping_id, exc,
            )
            return {"status": "failed", "error": f"schema fetch: {exc}"}

        # Skip target columns that are already mapped in the current draft.
        existing_targets = {
            (e.target_table, e.target_column)
            for e in (m.edges or [])
            if e.version_id is None
        }

        suggestions_created = 0
        for tgt_table, tgt_cols in target_schema.items():
            for tgt_col in tgt_cols:
                tgt_key = (tgt_table, tgt_col.get("name"))
                if tgt_key in existing_targets:
                    continue

                best_overall = None
                for src_table, src_cols in source_schema.items():
                    try:
                        result = AIService.match_schemas(
                            source_name=src_table, source_schema=src_cols,
                            target_name=tgt_table, target_schema=tgt_cols,
                        )
                    except Exception as exc:
                        logger.warning(
                            "AIService.match_schemas failed for "
                            "%s -> %s: %s", src_table, tgt_table, exc,
                        )
                        continue
                    for match in result.get("matches", []) or []:
                        if match.get("target") != tgt_col.get("name"):
                            continue
                        conf = float(match.get("confidence", 0) or 0)
                        if best_overall is None or conf > best_overall["confidence"]:
                            best_overall = {
                                "source_table": src_table,
                                "source_column": match["source"],
                                "source_type": next(
                                    (c.get("type") for c in src_cols
                                     if c.get("name") == match["source"]),
                                    None,
                                ),
                                "confidence": conf,
                                "reason": match.get("reason"),
                            }

                if best_overall and best_overall["confidence"] >= 50:
                    db.add(AISuggestion(
                        mapping_id=m.id,
                        target_table=tgt_table,
                        target_column=tgt_col["name"],
                        target_type=tgt_col.get("type"),
                        source_table=best_overall["source_table"],
                        source_column=best_overall["source_column"],
                        source_type=best_overall["source_type"],
                        confidence=best_overall["confidence"],
                        reason=best_overall["reason"],
                        status="pending",
                    ))
                    suggestions_created += 1

        db.flush()
        record_audit(
            db, "mapping_suggestions_ready",
            actor="mapping-suggester",
            connection_id=m.source_id,
            payload={
                "mapping_id": m.id,
                "suggestions_created": suggestions_created,
            },
        )
        db.commit()

        return {
            "status": "completed",
            "mapping_id": m.id,
            "suggestions_created": suggestions_created,
        }
    except Exception as exc:
        logger.error("suggest_mappings_task failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return {"status": "failed", "error": str(exc)}
    finally:
        db.close()
