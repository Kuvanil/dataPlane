"""Dashboard aggregation service (dashboard_tasks #1, #2, #7).

Fans out to the module tables (connectors, mappings, pipeline runs,
query history, audit log, autopilot runs) and returns one
``DashboardSummary`` payload. Each module read is isolated in its own
try/except so one broken module degrades to an ``error``/``unavailable``
tile instead of failing the whole endpoint (TRD FR6).

Divergences from the task-spec pseudocode, matched to the real models:
- ``DBConnection`` soft-deletes via ``is_deleted`` (connector_tasks #1) —
  only non-deleted rows count.
- Pipeline state lives on ``PipelineRun.status`` (``Pipeline`` itself has
  only ``enabled``): "running" counts current running/retrying runs,
  "failed" counts failed runs finished inside the selected range.
- ``Mapping`` soft-deletes via ``deleted_at``.
- Query Studio lives at ``/dashboard/query-studio`` (spec said ``/query``).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.autopilot import AutopilotRun
from app.models.connection import DBConnection
from app.models.mapping import Mapping
from app.models.pipeline import PipelineRun
from app.models.query_history import QueryHistory
from app.schemas.dashboard import DashboardSummary, FeedItem, KPITile
from app.services.dashboard_cache import get_cache

logger = logging.getLogger(__name__)

RANGE_DELTAS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}

RANGE_LABELS = {"24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days"}

# Prefix match order matters: first hit wins.
EVENT_TYPE_MODULE_MAP = (
    ("connector_", "connectors"),
    ("connection_", "connectors"),
    ("pipeline_", "pipelines"),
    ("mapping_", "mappings"),
    ("schema_drift", "schema_intel"),
    ("schema_", "schema_intel"),
    ("security_", "security"),
    ("autopilot_", "autopilot"),
    ("ai_", "autopilot"),
    ("query_", "query"),
    ("auth_", "system"),
)

MODULE_LINKS = {
    "connectors": "/dashboard/connectors",
    "pipelines": "/dashboard/pipelines",
    "mappings": "/dashboard/schema-mapper",
    "schema_intel": "/dashboard/schema",
    "security": "/dashboard/security",
    "autopilot": "/dashboard/autopilot",
    "query": "/dashboard/query-studio",
}

# Modules hidden from the `viewer` role (dashboard_tasks #7). Tiles are
# replaced with a "Restricted" placeholder; feed items are dropped.
RESTRICTED_MODULES = {"security", "autopilot", "audit"}

FEED_LIMIT = 10


class DashboardService:
    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, range: str = "7d", user=None) -> DashboardSummary:
        """Cached, role-scoped dashboard summary for the given time range."""
        cache = get_cache()
        user_id = getattr(user, "id", "anonymous")
        cache_key = f"dashboard_summary:{user_id}:{range}"
        if cache is not None:
            cached = cache.get(cache_key)
            if cached is not None:
                return cached

        summary = self._do_get_summary(range=range)
        summary = self._filter_by_role(summary, user)

        if cache is not None:
            cache[cache_key] = summary
        return summary

    # -- aggregation ----------------------------------------------------

    def _do_get_summary(self, range: str) -> DashboardSummary:
        logger.info("[dashboard] stage=aggregate range=%s", range)
        range_start = self._range_start(range)
        kpis: list[KPITile] = []

        # 1. Connectors (all-time — a connection either exists or it doesn't)
        try:
            rows = (
                self.db.query(DBConnection.type)
                .filter(DBConnection.is_deleted == False)  # noqa: E712
                .all()
            )
            type_count = len({r[0] for r in rows})
            kpis.append(KPITile(
                label="Connected Sources",
                value=len(rows),
                subtitle=f"{type_count} database type{'s' if type_count != 1 else ''}" if rows else "No connections yet",
                icon="🔌",
                link_url=MODULE_LINKS["connectors"],
                module="connectors",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001 — per-module isolation is the contract
            kpis.append(self._error_tile("Connected Sources", "connectors", e))

        # 2. Mappings (all-time, excluding soft-deleted)
        try:
            total = (
                self.db.query(func.count(Mapping.id))
                .filter(Mapping.deleted_at.is_(None))
                .scalar() or 0
            )
            kpis.append(KPITile(
                label="Mappings",
                value=total,
                subtitle="Drafts and published",
                icon="🔗",
                link_url=MODULE_LINKS["mappings"],
                module="mappings",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001
            kpis.append(self._error_tile("Mappings", "mappings", e))

        # 3. Pipelines — running is current state; failed is range-scoped
        try:
            running = (
                self.db.query(func.count(PipelineRun.id))
                .filter(PipelineRun.status.in_(("running", "retrying")))
                .scalar() or 0
            )
            failed = (
                self.db.query(func.count(PipelineRun.id))
                .filter(
                    PipelineRun.status == "failed",
                    PipelineRun.finished_at >= range_start,
                )
                .scalar() or 0
            )
            kpis.append(KPITile(
                label="Pipelines Running",
                value=running,
                icon="▶️",
                link_url=MODULE_LINKS["pipelines"],
                module="pipelines",
                status="loaded",
            ))
            kpis.append(KPITile(
                label="Pipelines Failed",
                value=failed,
                subtitle="Requires attention" if failed > 0 else RANGE_LABELS[range],
                trend="up" if failed > 0 else "neutral",
                icon="❌",
                link_url=MODULE_LINKS["pipelines"],
                module="pipelines",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001
            kpis.append(self._error_tile("Pipelines Running", "pipelines", e))
            kpis.append(self._error_tile("Pipelines Failed", "pipelines", e))

        # 4. Queries in range
        try:
            queries = (
                self.db.query(func.count(QueryHistory.id))
                .filter(QueryHistory.created_at >= range_start)
                .scalar() or 0
            )
            kpis.append(KPITile(
                label="Queries",
                value=queries,
                subtitle=RANGE_LABELS[range],
                icon="💡",
                link_url=MODULE_LINKS["query"],
                module="query",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001
            kpis.append(self._error_tile("Queries", "query", e))

        # 5. Audit-derived tiles: security alerts + drift events in range
        try:
            rows = (
                self.db.query(AuditLog.event_type, func.count(AuditLog.id))
                .filter(AuditLog.created_at >= range_start)
                .group_by(AuditLog.event_type)
                .all()
            )
            by_type = dict(rows)
            alerts = by_type.get("security_alert", 0)
            drift = by_type.get("schema_drift_detected", 0)
            kpis.append(KPITile(
                label="Security Alerts",
                value=alerts,
                subtitle=RANGE_LABELS[range],
                trend="up" if alerts > 0 else "neutral",
                icon="🔒",
                link_url=MODULE_LINKS["security"],
                module="security",
                status="loaded",
            ))
            kpis.append(KPITile(
                label="Drift Events",
                value=drift,
                subtitle="Schema changes detected" if drift > 0 else "No drift detected",
                trend="up" if drift > 0 else "neutral",
                icon="🛡️",
                link_url=MODULE_LINKS["schema_intel"],
                module="schema_intel",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001
            kpis.append(self._error_tile("Security Alerts", "security", e))
            kpis.append(self._error_tile("Drift Events", "schema_intel", e))

        # 6. Autopilot runs in range
        try:
            runs = (
                self.db.query(func.count(AutopilotRun.id))
                .filter(AutopilotRun.started_at >= range_start)
                .scalar() or 0
            )
            kpis.append(KPITile(
                label="AI Autopilot Actions",
                value=runs,
                subtitle=RANGE_LABELS[range],
                icon="🤖",
                link_url=MODULE_LINKS["autopilot"],
                module="autopilot",
                status="loaded",
            ))
        except Exception as e:  # noqa: BLE001
            kpis.append(self._error_tile("AI Autopilot Actions", "autopilot", e))

        # 7. Activity feed — newest audit events in range. Optional: an
        # empty list (not an error tile) if the audit table is unreadable.
        feed: list[FeedItem] = []
        try:
            events = (
                self.db.query(AuditLog)
                .filter(AuditLog.created_at >= range_start)
                .order_by(AuditLog.created_at.desc())
                .limit(FEED_LIMIT)
                .all()
            )
            feed = [self._to_feed_item(e) for e in events]
        except Exception:  # noqa: BLE001
            try:
                self.db.rollback()
            except Exception:
                logger.exception("[dashboard] session rollback failed")
            logger.exception("[dashboard] stage=aggregate module=feed failed")

        return DashboardSummary(
            kpis=kpis,
            feed=feed,
            range=range,
            generated_at=datetime.now(timezone.utc),
        )

    # -- role scoping (dashboard_tasks #7) -------------------------------

    def _filter_by_role(self, summary: DashboardSummary, user) -> DashboardSummary:
        """Viewer (or unknown/missing role — least privilege) gets restricted
        modules masked; admin and analyst see everything."""
        role = getattr(user, "role", "viewer")
        if role in ("admin", "analyst"):
            return summary

        kpis = [
            kpi if kpi.module not in RESTRICTED_MODULES else KPITile(
                label=kpi.label,
                value=0,
                subtitle="Restricted",
                icon=kpi.icon,
                link_url="",
                module=kpi.module,
                status="unavailable",
                error_message="You do not have permission to view this data.",
            )
            for kpi in summary.kpis
        ]
        feed = [item for item in summary.feed if item.module not in RESTRICTED_MODULES]

        return DashboardSummary(
            kpis=kpis,
            feed=feed,
            range=summary.range,
            generated_at=summary.generated_at,
        )

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _range_start(range: str) -> datetime:
        return datetime.now(timezone.utc) - RANGE_DELTAS.get(range, RANGE_DELTAS["7d"])

    def _error_tile(self, label: str, module: str, exc: Exception) -> KPITile:
        # A failed query leaves the session in an aborted transaction; without
        # a rollback every later module query would fail too, defeating the
        # per-module isolation this endpoint exists to provide.
        try:
            self.db.rollback()
        except Exception:
            logger.exception("[dashboard] session rollback failed")
        # Missing table / broken schema means the module isn't deployed yet
        # ("unavailable"); anything else is a real error.
        status = "unavailable" if isinstance(exc, (OperationalError, ProgrammingError)) else "error"
        logger.exception("[dashboard] stage=aggregate module=%s failed", module)
        return KPITile(
            label=label,
            value=0,
            link_url=MODULE_LINKS.get(module, "/dashboard"),
            module=module,
            status=status,
            error_message=str(exc)[:200],
        )

    def _to_feed_item(self, event: AuditLog) -> FeedItem:
        module = "system"
        for prefix, mod in EVENT_TYPE_MODULE_MAP:
            if event.event_type.startswith(prefix):
                module = mod
                break

        summary = event.event_type.replace("_", " ").capitalize()
        if event.connection_name:
            summary = f"{summary} — {event.connection_name}"

        return FeedItem(
            id=event.id,
            event_type=event.event_type,
            actor=event.actor or "system",
            module=module,
            summary=summary,
            status=event.status or "success",
            created_at=event.created_at,
            link_url=MODULE_LINKS.get(module),
        )
