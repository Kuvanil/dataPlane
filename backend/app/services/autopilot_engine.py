"""Autopilot recommendation engine (ai_autopilot_tasks #5, FR2).

Trigger evaluators are pure functions over persisted metadata/state —
rationale is deterministic and templated, never LLM-generated and never
derived from data *content* (TRD §10 prompt-injection mitigation, INDEX
design decision 2).

Trigger set v1 (grounded in tables that exist today):
  1. Connector health — connections currently degraded/down.
  2. Schema drift    — DriftEvents in the lookback window that affect
                       draft mappings.

Dedupe/supersede (INDEX decision 7): an open recommendation per
(action_type, subject) is refreshed in place, never duplicated; open
recommendations whose trigger has cleared are superseded.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.autopilot import AutopilotRecommendation
from app.models.connection import DBConnection
from app.models.drift_event import DriftEvent
from app.models.mapping import Mapping
from app.services.audit_helper import record_audit
from app.services.autopilot_service import AutopilotService

logger = logging.getLogger(__name__)

ENGINE_ACTOR = "autopilot-engine"
# Action types this engine owns end-to-end (creates AND supersedes).
# migration_execute recs are human-created (legacy reroute) — never touched.
ENGINE_MANAGED_TYPES = ("connector_health_check", "mapping_suggestions_refresh")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AutopilotEngine:

    # ── Evaluators ────────────────────────────────────────────

    @staticmethod
    def _evaluate_connector_health(db: Session) -> List[Dict[str, Any]]:
        drafts: List[Dict[str, Any]] = []
        unhealthy = (
            db.query(DBConnection)
            .filter(
                DBConnection.is_deleted == False,  # noqa: E712
                DBConnection.health_status.in_(("degraded", "down")),
            )
            .all()
        )
        for conn in unhealthy:
            evidence = [
                f"health_status={conn.health_status}",
                f"last_tested_at={conn.last_tested_at}",
            ]
            if conn.last_test_error:
                evidence.append(f"last_test_error={conn.last_test_error[:200]}")
            dependents = [
                m.name for m in (
                    db.query(Mapping)
                    .filter(
                        Mapping.deleted_at.is_(None),
                        (Mapping.source_id == conn.id) | (Mapping.target_id == conn.id),
                    )
                    .limit(5)
                    .all()
                )
            ]
            if dependents:
                evidence.append(f"used by mappings: {', '.join(dependents)}")
            drafts.append({
                "action_type": "connector_health_check",
                "subject": f"connection:{conn.id}",
                "payload": {"connection_id": conn.id},
                "confidence": 90.0,  # mechanical re-test; near-certain applicability
                "rationale": {
                    "summary": (
                        f"Connection '{conn.name}' is {conn.health_status}; "
                        "re-test to confirm recovery or persistent failure."
                    ),
                    "evidence": evidence,
                    "trigger": {
                        "kind": "connector_health",
                        "connection_id": conn.id,
                        "health_status": conn.health_status,
                    },
                },
            })
        return drafts

    @staticmethod
    def _evaluate_schema_drift(db: Session) -> List[Dict[str, Any]]:
        drafts: List[Dict[str, Any]] = []
        since = _now() - timedelta(hours=settings.AUTOPILOT_DRIFT_LOOKBACK_HOURS)
        events = (
            db.query(DriftEvent)
            .filter(DriftEvent.detected_at >= since)
            .order_by(DriftEvent.detected_at.desc())
            .all()
        )
        # Newest event per connection wins (older ones add nothing actionable).
        latest_by_conn: Dict[int, DriftEvent] = {}
        for ev in events:
            latest_by_conn.setdefault(ev.connection_id, ev)

        for conn_id, ev in latest_by_conn.items():
            affected = (
                db.query(Mapping)
                .filter(
                    Mapping.status == "draft",
                    Mapping.deleted_at.is_(None),
                    (Mapping.source_id == conn_id) | (Mapping.target_id == conn_id),
                )
                .all()
            )
            if not affected:
                continue
            added = len(ev.tables_added or []) + len(ev.columns_added or [])
            removed = len(ev.tables_removed or []) + len(ev.columns_removed or [])
            retyped = len(ev.type_changes or [])
            # Additions mean new unmapped surface — suggestions directly help;
            # removals/retypes still warrant a refresh but less certainly.
            confidence = 80.0 if added else 65.0
            conn = db.query(DBConnection).filter(DBConnection.id == conn_id).first()
            conn_name = conn.name if conn else f"#{conn_id}"
            for m in affected:
                drafts.append({
                    "action_type": "mapping_suggestions_refresh",
                    "subject": f"mapping:{m.id}",
                    "payload": {"mapping_id": m.id},
                    "confidence": confidence,
                    "rationale": {
                        "summary": (
                            f"Schema drift on connection '{conn_name}' "
                            f"(+{added} added, -{removed} removed, "
                            f"{retyped} type changes); refresh AI suggestions "
                            f"for draft mapping '{m.name}' so the changed "
                            "columns get mapped."
                        ),
                        "evidence": [
                            f"drift_event_id={ev.id}",
                            f"detected_at={ev.detected_at}",
                            f"tables_added={ev.tables_added}",
                            f"columns_added={len(ev.columns_added or [])}",
                            f"columns_removed={len(ev.columns_removed or [])}",
                            f"type_changes={retyped}",
                        ],
                        "trigger": {
                            "kind": "schema_drift",
                            "drift_event_id": ev.id,
                            "connection_id": conn_id,
                        },
                    },
                })
        return drafts

    # ── Supersede cleared triggers ────────────────────────────

    @staticmethod
    def _supersede_cleared(db: Session) -> int:
        superseded = 0
        open_recs = (
            db.query(AutopilotRecommendation)
            .filter(
                AutopilotRecommendation.status == "pending",
                AutopilotRecommendation.action_type.in_(ENGINE_MANAGED_TYPES),
            )
            .all()
        )
        for rec in open_recs:
            reason = None
            if rec.action_type == "connector_health_check":
                conn = (
                    db.query(DBConnection)
                    .filter(DBConnection.id == rec.payload.get("connection_id"))
                    .first()
                )
                if conn is None or conn.is_deleted:
                    reason = "connection deleted"
                elif conn.health_status == "healthy":
                    reason = "connection is healthy again"
            elif rec.action_type == "mapping_suggestions_refresh":
                m = (
                    db.query(Mapping)
                    .filter(Mapping.id == rec.payload.get("mapping_id"))
                    .first()
                )
                if m is None or m.deleted_at is not None:
                    reason = "mapping deleted"
                elif m.status != "draft":
                    reason = f"mapping is '{m.status}' — suggestions are draft-only"
            if reason and AutopilotService.supersede(db, rec, reason=reason):
                superseded += 1
        return superseded

    # ── Entrypoint ────────────────────────────────────────────

    @staticmethod
    def evaluate_all(db: Session, *, actor: str = ENGINE_ACTOR) -> Dict[str, int]:
        """Run all evaluators; dedupe, supersede cleared triggers, then hand
        newly created recommendations to the auto-dispatch decision."""
        logger.info("[pipeline] stage=autopilot_evaluate actor=%s", actor)
        drafts = (
            AutopilotEngine._evaluate_connector_health(db)
            + AutopilotEngine._evaluate_schema_drift(db)
        )
        created_recs = []
        refreshed = 0
        for d in drafts:
            rec, created = AutopilotService.upsert_recommendation(
                db,
                action_type=d["action_type"],
                subject=d["subject"],
                payload=d["payload"],
                rationale=d["rationale"],
                confidence=d["confidence"],
                created_by=actor,
            )
            if created:
                created_recs.append(rec)
            else:
                refreshed += 1

        superseded = AutopilotEngine._supersede_cleared(db)

        counts = {
            "created": len(created_recs),
            "refreshed": refreshed,
            "superseded": superseded,
        }
        if counts["created"] or counts["superseded"]:
            record_audit(db, "autopilot_evaluated", actor=actor, payload=counts)
        # Make new recommendations durable BEFORE any auto-dispatch: the
        # executor task opens its own session and must see them.
        db.commit()

        auto_dispatched = 0
        for rec in created_recs:
            if AutopilotService.maybe_auto_execute(db, rec) == "auto_dispatched":
                auto_dispatched += 1
        db.commit()  # persists any policy-disabled supersedes from the loop
        counts["auto_dispatched"] = auto_dispatched
        logger.info("[pipeline] stage=autopilot_evaluate done %s", counts)
        return counts
