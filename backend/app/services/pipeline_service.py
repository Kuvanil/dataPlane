"""Pipeline Service.

Two responsibilities coexist in this module under the Task #1 design:

  1. Legacy synchronous graph executor (`execute_pipeline` + helpers).
     Pre-dates the TRD; stateless; AI-matcher driven. **Will be replaced
     by Task #3** (execution engine that consumes published mapping
     versions). Kept untouched here so Task #3 can land as a clean swap.

  2. CRUD surface for the persistent `Pipeline` / `PipelineRun` models
     added in Task #1: `create_pipeline`, `get_pipeline`, `list_pipelines`,
     `update_pipeline`, `delete_pipeline`, `list_runs`. Mirrors the
     `MappingService` pattern from the Schema Mapper upgrade.

Task #2 adds `compute_schema_hash` and `PipelineCRUD.validate_drift` for
the FR2 / AC2 pre-run drift check. Task #3 will call validate_drift at
the entrypoint of execute (manual and scheduled); the same method is
exposed via GET /pipelines/{id}/drift so users can preview before running.
"""

import hashlib
import json
import logging
import os
import sqlite3
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.models.mapping import Mapping, MappingVersion
from app.models.pipeline import Pipeline, PipelineRun
from app.services.ai_service import AIService
from app.services.audit_helper import record_audit
from app.services.schema_mapper_service import SchemaMapperService
from app.services.schema_service import SchemaService

logger = logging.getLogger(__name__)


PIPELINE_NODE_TYPES = {"source", "ai_matcher", "target"}
CONFIDENCE_THRESHOLD = 50


# ── Schema-hash helper (Task #2) ───────────────────────────────────

def compute_schema_hash(schema: Dict[str, Any]) -> str:
    """Canonical SHA-256 of a normalized schema dict.

    Used by Task #2's drift check (`PipelineCRUD.validate_drift`) and
    surfaceable in `DriftValidationRead` for human-readable drift
    reports. The hash is order-independent at the top level (tables are
    sorted) but stable for nested dicts/lists so two schemas with the
    same content always produce the same hash.
    """
    normalized = json.dumps(schema, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _schemas_equal(a: Any, b: Any) -> bool:
    """Deep-equal comparison that tolerates list ordering on inner
    columns arrays (connectors may report columns in different orders
    between calls). For Task #2's check this is more robust than a raw
    hash equality."""
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return False
        return all(_schemas_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        # Match each item in a to some item in b with the same shape.
        # Naive O(n^2) but n is small per table.
        for item_a in a:
            if not any(_schemas_equal(item_a, item_b) for item_b in b):
                return False
        return True
    return a == b


class PipelineService:
    """CRUD + executor facade for the Pipelines module."""

    # ── Legacy synchronous graph executor (replaced by Task #3) ───────
    # ── This block stays as-is until Task #3 ships its replacement. ────

    @staticmethod
    def execute_pipeline(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Execute a `source -> ai_matcher -> target` pipeline and return the result.

        Parameters
        ----------
        nodes : list of dict
            Pipeline node definitions. Each node must have an ``id`` and ``type``
            (one of ``source``, ``ai_matcher``, ``target``). ``source`` and
            ``target`` nodes must include ``config.connection_id``.
        edges : list of dict
            Pipeline edge definitions. Each edge must have ``source`` and
            ``target`` fields referencing node ids.

        Returns
        -------
        dict
            Result envelope (see module docstring).
        """
        logger.info("[pipeline] stage=validate nodes=%d edges=%d", len(nodes), len(edges))
        source_node, target_node, ai_matcher_node = PipelineService._validate_graph(nodes, edges)

        source_config = (source_node.get("config") or {})
        target_config = (target_node.get("config") or {})
        source_id = source_config.get("connection_id")
        target_id = target_config.get("connection_id")

        if not isinstance(source_id, int) or source_id <= 0:
            raise ValueError("Source node must have a connection_id configured")
        if not isinstance(target_id, int) or target_id <= 0:
            raise ValueError("Target node must have a connection_id configured")

        logger.info("[pipeline] stage=load_connections source_id=%d target_id=%d", source_id, target_id)
        source_conn, target_conn = PipelineService._load_connections(source_id, target_id)

        logger.info("[pipeline] stage=extract_schemas source='%s' target='%s'", source_conn.name, target_conn.name)
        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)
        logger.info("[pipeline] source_tables=%d target_tables=%d", len(source_schema), len(target_schema))

        on_the_fly_ddl: List[str] = []
        used_identity_matching = False

        # ── Legacy matching logic preserved verbatim. ────────────────
        table_mappings: List[Dict[str, Any]] = []
        matched_targets: set = set()

        if ai_matcher_node is not None:
            used_identity_matching = True
            identity_table_pairs = _find_identity_table_pairs(source_schema, target_schema)
            logger.info("[pipeline] stage=ai_match identity_pairs=%d", len(identity_table_pairs))

            for src_table, tgt_table in identity_table_pairs:
                src_cols = source_schema.get(src_table, [])
                tgt_cols = target_schema.get(tgt_table, [])
                matches: List[Dict[str, Any]] = []
                for src_c in src_cols:
                    for tgt_c in tgt_cols:
                        if (
                            isinstance(src_c, dict)
                            and isinstance(tgt_c, dict)
                            and src_c.get("name") == tgt_c.get("name")
                        ):
                            matches.append({
                                "source_column": src_c.get("name"),
                                "target_column": tgt_c.get("name"),
                                "type": src_c.get("type", "?"),
                            })
                if not matches:
                    continue
                table_mappings.append({
                    "source_table": src_table,
                    "target_table": tgt_table,
                    "confidence": 100,
                    "details": {"matches": matches, "identity": True},
                })
                matched_targets.add(tgt_table)

        unmatched_target = [
            t for t in target_schema.keys() if t not in matched_targets
        ]

        return table_mappings, unmatched_source, unmatched_target


# ── Helpers for the legacy executor (do not touch until Task #3) ────

def _find_identity_table_pairs(
    source_schema: Dict[str, List[Dict[str, Any]]],
    target_schema: Dict[str, List[Dict[str, Any]]],
) -> List[tuple]:
    pairs: List[tuple] = []
    for s, sc in source_schema.items():
        for t, tc in target_schema.items():
            if s == t:
                pairs.append((s, t))
                continue
            if not isinstance(sc, list) or not isinstance(tc, list):
                continue
            src_names = {c.get("name") for c in sc if isinstance(c, dict)}
            tgt_names = {c.get("name") for c in tc if isinstance(c, dict)}
            if src_names and tgt_names and src_names.issubset(tgt_names):
                pairs.append((s, t))
    return pairs


# ── Module-level helpers (not legacy) ───────────────────────────────

def _resolve_published_version(db: Session, mapping_id: int) -> MappingVersion:
    """Return the current published version of a mapping.

    Pipelines pin a published version at create time so drift checks
    (Task #2) have a stable baseline. Raises 422 if the mapping has no
    current published version yet (i.e. still draft).
    """
    m = db.query(Mapping).filter(Mapping.id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"mapping {mapping_id} not found")
    if m.status != "published" or m.current_version_id is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"mapping {mapping_id} is not published; publish it before "
                f"creating a pipeline (pinned mapping_version_id required)"
            ),
        )
    v = (
        db.query(MappingVersion)
        .filter(MappingVersion.id == m.current_version_id)
        .first()
    )
    if not v:
        raise HTTPException(
            status_code=422,
            detail=f"mapping {mapping_id} has no readable current version",
        )
    return v


# ── Task #1: CRUD surface on the persistent Pipeline / PipelineRun ─

class PipelineCRUD:
    """Static-method facade for CRUD on Pipeline / PipelineRun.

    Split from `PipelineService.execute_pipeline` so Task #3 can replace
    the executor without touching this surface. Imports stay shared at
    the module level.
    """

    @staticmethod
    def create_pipeline(
        db: Session,
        *,
        name: str,
        source_connection_id: int,
        target_connection_id: int,
        mapping_id: int,
        actor: str,
    ) -> Pipeline:
        if source_connection_id == target_connection_id:
            raise HTTPException(
                status_code=422,
                detail="source_connection_id and target_connection_id must differ",
            )
        for cid, label in ((source_connection_id, "source"), (target_connection_id, "target")):
            if not db.query(DBConnection).filter(DBConnection.id == cid).first():
                raise HTTPException(
                    status_code=404, detail=f"{label} connection {cid} not found",
                )

        # Pin the mapping's current published version (FR1). drift
        # checks (Task #2) will compare against this snapshot.
        version = _resolve_published_version(db, mapping_id)

        pipeline = Pipeline(
            name=name,
            source_connection_id=source_connection_id,
            target_connection_id=target_connection_id,
            mapping_id=mapping_id,
            mapping_version_id=version.id,
            enabled=1,
            created_by=actor,
        )
        db.add(pipeline)
        db.flush()
        record_audit(
            db, "pipeline_created", actor=actor,
            connection_id=source_connection_id,
            payload={
                "pipeline_id": pipeline.id,
                "name": name,
                "source_connection_id": source_connection_id,
                "target_connection_id": target_connection_id,
                "mapping_id": mapping_id,
                "mapping_version_id": version.id,
            },
        )
        db.commit()
        db.refresh(pipeline)
        return pipeline

    @staticmethod
    def get_pipeline(db: Session, pipeline_id: int) -> Pipeline:
        p = db.query(Pipeline).filter(Pipeline.id == pipeline_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="pipeline not found")
        return p

    @staticmethod
    def list_pipelines(
        db: Session, *, limit: int = 50, offset: int = 0,
    ) -> tuple:
        """Return (items, total) for paginated list (mirrors the
        MappingService.list_pagination helper)."""
        base = db.query(Pipeline)
        total = base.count()
        items = base.order_by(Pipeline.created_at.desc()).offset(offset).limit(limit).all()
        return items, total

    @staticmethod
    def update_pipeline(
        db: Session,
        pipeline_id: int,
        *,
        name: Optional[str],
        enabled: Optional[bool],
        actor: str,
    ) -> Pipeline:
        p = PipelineCRUD.get_pipeline(db, pipeline_id)
        before = {"name": p.name, "enabled": bool(p.enabled)}
        if name is not None:
            p.name = name
        if enabled is not None:
            p.enabled = 1 if enabled else 0
        db.flush()
        record_audit(
            db, "pipeline_updated", actor=actor,
            connection_id=p.source_connection_id,
            payload={
                "pipeline_id": p.id,
                "before": before,
                "after": {"name": p.name, "enabled": bool(p.enabled)},
            },
        )
        db.commit()
        db.refresh(p)
        return p

    @staticmethod
    def delete_pipeline(db: Session, pipeline_id: int, *, actor: str) -> None:
        p = PipelineCRUD.get_pipeline(db, pipeline_id)
        before = {"name": p.name, "mapping_id": p.mapping_id}
        # Hard delete with cascade on schedules, retry_policy, runs,
        # run_steps (declared in app/models/pipeline.py). Suitable for
        # a draft that hasn't been published; for already-published
        # pipelines we may want a soft-delete (FR DoD) -- flagged as a
        # follow-up.
        db.delete(p)
        db.flush()
        record_audit(
            db, "pipeline_deleted", actor=actor,
            connection_id=p.source_connection_id,
            payload={"pipeline_id": pipeline_id, "before": before},
        )
        db.commit()

    @staticmethod
    def list_runs(
        db: Session,
        pipeline_id: int,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple:
        # Verify the pipeline exists so 404 fires cleanly instead of an
        # empty list (which would be ambiguous).
        PipelineCRUD.get_pipeline(db, pipeline_id)
        base = db.query(PipelineRun).filter(PipelineRun.pipeline_id == pipeline_id)
        total = base.count()
        items = base.order_by(PipelineRun.id.desc()).offset(offset).limit(limit).all()
        return items, total

    # ── Task #2: Drift validation (FR2 / AC2) ────────────────────

    @staticmethod
    def validate_drift(db: Session, pipeline_id: int, *, actor: str = "system"):
        """Compare the live source schema to the snapshot captured when the
        pinned mapping_version was published.

        Returns a DriftValidationRead-shaped dict. `has_drift=True` means
        the run must be blocked (AC2). Task #3's executor will call this
        before extract and record a PipelineRun with status='failed' and
        error_message naming the drift when blocked.

        Implementation note (review flag): the task spec recommends
        eventually hashing only the subset of source columns actually
        referenced by the mapping's FieldMapping.sources so unrelated
        source-table changes don't spuriously block unrelated pipelines.
        For Task #2 we hash the full source schema; the per-mapping
        subset is a follow-up if false-positive blocks become a problem
        in practice.
        """
        p = PipelineCRUD.get_pipeline(db, pipeline_id)
        version = (
            db.query(MappingVersion)
            .filter(MappingVersion.id == p.mapping_version_id)
            .first()
        )
        if version is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"pipeline {p.id} pins mapping_version {p.mapping_version_id} "
                    "which no longer exists"
                ),
            )

        # Fetch the live source schema.
        source_conn = (
            db.query(DBConnection)
            .filter(DBConnection.id == p.source_connection_id)
            .first()
        )
        if source_conn is None:
            raise HTTPException(
                status_code=422,
                detail=f"source connection {p.source_connection_id} no longer exists",
            )
        try:
            live_source = SchemaService.get_full_schema(source_conn)
        except Exception as exc:
            logger.warning(
                "validate_drift: schema fetch failed for pipeline %s: %s",
                pipeline_id, exc,
            )
            raise HTTPException(
                status_code=502,
                detail=f"failed to fetch live source schema: {exc}",
            ) from exc

        snapshot = (version.schema_snapshot or {}).get("source", {}) or {}
        live_hash = compute_schema_hash(live_source)
        baseline_hash = compute_schema_hash(snapshot) if snapshot else None

        has_drift = not _schemas_equal(live_source, snapshot) if snapshot else False
        changed_tables = _diff_table_names(snapshot, live_source)

        result = {
            "pipeline_id": p.id,
            "has_drift": has_drift,
            "baseline_hash": baseline_hash,
            "current_hash": live_hash,
            "changed_tables": changed_tables,
            "message": (
                "source schema has changed since mapping was published; "
                "re-publish the mapping or update it before running"
            ) if has_drift else "no drift detected",
        }
        # Record an audit event so the drift check itself is traceable.
        # (Distinct from the run-failure audit that Task #3's executor
        # will emit when it blocks a run because of this result.)
        record_audit(
            db, "pipeline_drift_check", actor=actor,
            connection_id=p.source_connection_id,
            payload={
                "pipeline_id": p.id,
                "mapping_version_id": version.id,
                "has_drift": has_drift,
                "changed_tables": changed_tables,
            },
            status="failure" if has_drift else "success",
        )
        db.commit()
        return result


def _diff_table_names(baseline: Dict[str, Any], live: Dict[str, Any]) -> List[str]:
    """Return the names of tables present in baseline but not in live
    (or with different keys), surfaced in DriftValidationRead for
    human-readable drift reports. Naive (just key differences); cheap
    enough for the volumes we expect."""
    base_tables = set(baseline.keys())
    live_tables = set(live.keys())
    return sorted(base_tables.symmetric_difference(live_tables))
