"""Celery task for AI mapping suggestions (Schema Mapper upgrade).

Performance fix (review §11.5): the prior implementation called
``AIService.match_schemas(target_schema=tgt_cols, ...)`` once per
**target column** — making the total LLM-call cost
``Σ(target_columns) × Σ(source_tables)`` instead of
``Σ(target_tables) × Σ(source_tables)``. At the TRD's own target scale
(50 tables / 1,000 columns) this is ~1000× more LLM calls than necessary
and blows past the 3-second p95 NFR.

This rewrite hoists the ``match_schemas`` call outside the per-column
loop: one call per (source_table, target_table) pair, then the resulting
matches are distributed to their respective unmapped target columns.
"""
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
    """Walk unmapped target columns and create AI suggestions for each.

    Algorithm:
      For each target table T:
        U = unmapped target columns in T
        if U is empty: skip
        best_by_col = {}
        For each source table S:
          result = AIService.match_schemas(S, T, all unmapped cols in U)
          For each match in result.matches where match.target in U:
            keep the highest-confidence match per target column
        For each target column with best match (confidence >= 50):
          create AISuggestion row
    """
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
            # Collect the unmapped target columns for this table.
            unmapped_cols = [
                c for c in tgt_cols
                if (tgt_table, c.get("name")) not in existing_targets
            ]
            if not unmapped_cols:
                continue

            # best_by_col: target_column_name -> best (source, confidence) found.
            best_by_col: Dict[str, Dict[str, Any]] = {}

            for src_table, src_cols in source_schema.items():
                try:
                    # One call per (src_table, tgt_table) — not per column.
                    result = AIService.match_schemas(
                        source_name=src_table, source_schema=src_cols,
                        target_name=tgt_table, target_schema=unmapped_cols,
                    )
                except Exception as exc:
                    logger.warning(
                        "AIService.match_schemas failed for %s -> %s: %s",
                        src_table, tgt_table, exc,
                    )
                    continue
                for match in result.get("matches", []) or []:
                    tgt_name = match.get("target")
                    if tgt_name not in {c.get("name") for c in unmapped_cols}:
                        continue
                    conf = float(match.get("confidence", 0) or 0)
                    existing_best = best_by_col.get(tgt_name)
                    if existing_best is None or conf > existing_best["confidence"]:
                        best_by_col[tgt_name] = {
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

            # Materialize one AISuggestion per target column with a best match
            # above the confidence threshold.
            for tgt_col in unmapped_cols:
                best = best_by_col.get(tgt_col.get("name"))
                if not best or best["confidence"] < 50:
                    continue
                db.add(AISuggestion(
                    mapping_id=m.id,
                    target_table=tgt_table,
                    target_column=tgt_col["name"],
                    target_type=tgt_col.get("type"),
                    source_table=best["source_table"],
                    source_column=best["source_column"],
                    source_type=best["source_type"],
                    confidence=best["confidence"],
                    reason=best["reason"],
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
