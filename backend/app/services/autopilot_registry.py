"""Autopilot action registry + server-side guardrails (ai_autopilot_tasks #4).

This module is the single source of truth for what Autopilot is *able* to do
(FR4) and what it must *never* do (FR5/AC3). Guardrails live here in the
service layer — the router and any policy configuration are irrelevant to
them:

- ``ACTION_REGISTRY`` is the allow-list. Anything not in it is refused
  (default-deny), which structurally subsumes every prohibited action.
- ``PROHIBITED_ACTION_TYPES`` additionally names the actions the TRD calls
  out (access-control / credential / security changes, irreversible deletes,
  mapping publish, raw DDL) so they fail with an explicit "prohibited
  regardless of policy configuration" error and are directly testable.
- ``auto_capable`` is a derived invariant: an action may run autonomously
  only if it is reversible AND low-risk (TRD FR4). Asserted at import time
  so a registry edit can't silently widen the autonomous surface.

Executor callables ground exclusively into already-shipped code paths;
imports are deferred into the callables to keep this module import-light
(it is imported by the router, services, and Celery tasks).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, FrozenSet

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProhibitedActionError(Exception):
    """Raised for action types Autopilot must never perform (FR5)."""


class UnknownActionError(Exception):
    """Raised for action types not in the registry (default-deny)."""


class PayloadValidationError(Exception):
    """Raised when a recommendation payload fails registry validation."""


# Reserved key an executor may set in its result dict: a zero-arg callable
# the caller must invoke only AFTER its transaction commits (bugs/01). The
# key is popped before the result is persisted as execution_result.
DISPATCH_AFTER_COMMIT_KEY = "_dispatch_after_commit"


@dataclass(frozen=True)
class ActionSpec:
    action_type: str
    description: str
    risk: str  # low | medium | high
    reversible: bool
    reversibility_note: str
    auto_capable: bool
    required_payload_keys: FrozenSet[str]
    execute: Callable[[Session, Dict[str, Any], str], Dict[str, Any]]


# ── Executors (grounded in shipped code only) ─────────────────────────────


def _exec_connector_health_check(db: Session, payload: Dict[str, Any],
                                 actor: str) -> Dict[str, Any]:
    """Re-test a connection and persist its health status.

    Same core as ``run_health_check_for_connection`` (connector_tasks #5):
    SchemaService.test_connection owns the timeout and never raises.
    """
    from app.models.connection import DBConnection
    from app.services.connection_service import ConnectionService
    from app.services.schema_service import SchemaService

    conn = (
        db.query(DBConnection)
        .filter(DBConnection.id == payload["connection_id"],
                DBConnection.is_deleted == False)  # noqa: E712
        .first()
    )
    if not conn:
        raise ValueError(f"connection {payload['connection_id']} not found or deleted")
    result = SchemaService.test_connection(conn)
    if result.success:
        ConnectionService.update_health(db, conn.id, "healthy")
    elif result.reachable:
        ConnectionService.update_health(db, conn.id, "degraded", result.error_message)
    else:
        ConnectionService.update_health(db, conn.id, "down", result.error_message)
    return {
        "connection_id": conn.id,
        "success": result.success,
        "reachable": result.reachable,
        "error_code": result.error_code,
    }


def _exec_drift_rescan(db: Session, payload: Dict[str, Any],
                       actor: str) -> Dict[str, Any]:
    """Snapshot + drift-check one connection (same path as POST /schema/{id}/rescan)."""
    from app.models.connection import DBConnection
    from app.tasks.ai_tasks import _check_single_connection_drift

    conn = (
        db.query(DBConnection)
        .filter(DBConnection.id == payload["connection_id"],
                DBConnection.is_deleted == False)  # noqa: E712
        .first()
    )
    if not conn:
        raise ValueError(f"connection {payload['connection_id']} not found or deleted")
    result = _check_single_connection_drift(db, conn, actor=actor)
    if "error" in result:
        raise ValueError(f"rescan failed: {result['error']}")
    return {"connection_id": conn.id, "drift": result.get("drift", False)}


def _exec_mapping_suggestions_refresh(db: Session, payload: Dict[str, Any],
                                      actor: str) -> Dict[str, Any]:
    """Enqueue AI suggestion generation for a draft mapping.

    ``MappingService.request_suggestions`` asserts the mapping is a draft —
    a published mapping surfaces as a clean execution failure, not a crash.
    """
    from fastapi import HTTPException
    from app.services.mapping_service import MappingService

    try:
        task_id = MappingService.request_suggestions(
            db, payload["mapping_id"], actor=actor,
        )
    except HTTPException as exc:
        raise ValueError(f"suggestions refresh refused: {exc.detail}") from exc
    return {"mapping_id": payload["mapping_id"], "task_id": task_id}


def _exec_migration_execute(db: Session, payload: Dict[str, Any],
                            actor: str) -> Dict[str, Any]:
    """Start a legacy autopilot run in execute mode (approval-gated only —
    never auto; see auto_capable=False below).

    Transaction contract (bugs/01): executor callables NEVER commit the
    caller's session — ``execute_recommendation`` owns the boundary. The
    run row is flushed here and the Celery dispatch is returned under
    ``DISPATCH_AFTER_COMMIT_KEY`` so the caller can fire it strictly after
    the transaction lands (the worker writes FK'd AutopilotLog rows, so
    dispatching before commit races; committing here breaks atomicity).
    """
    import uuid
    from app.models.autopilot import AutopilotRun
    from app.models.connection import DBConnection
    from app.tasks.ai_tasks import run_autopilot_task

    source_id, target_id = payload["source_id"], payload["target_id"]
    for cid, label in ((source_id, "source"), (target_id, "target")):
        exists = (
            db.query(DBConnection)
            .filter(DBConnection.id == cid,
                    DBConnection.is_deleted == False)  # noqa: E712
            .first()
        )
        if not exists:
            raise ValueError(f"{label} connection {cid} not found or deleted")

    run_id = str(uuid.uuid4())
    db.add(AutopilotRun(
        id=run_id, source_id=source_id, target_id=target_id,
        mode="execute", model=payload.get("model", "llama3"), status="running",
    ))
    db.flush()

    def _dispatch() -> None:
        run_autopilot_task.delay(
            run_id=run_id, source_id=source_id,
            target_id=target_id, mode="execute",
        )

    return {"run_id": run_id, DISPATCH_AFTER_COMMIT_KEY: _dispatch}


# ── Registry + prohibited set ─────────────────────────────────────────────


ACTION_REGISTRY: Dict[str, ActionSpec] = {
    spec.action_type: spec
    for spec in (
        ActionSpec(
            action_type="connector_health_check",
            description="Re-test a degraded/down connection and record its health status",
            risk="low",
            reversible=True,
            reversibility_note="Read-only probe; only updates the health-status fields, which the next scheduled check overwrites anyway.",
            auto_capable=True,
            required_payload_keys=frozenset({"connection_id"}),
            execute=_exec_connector_health_check,
        ),
        ActionSpec(
            action_type="drift_rescan",
            description="Snapshot a connection's schema and record drift against the previous snapshot",
            risk="low",
            reversible=True,
            reversibility_note="Additive: writes a new snapshot/drift-event row; no live schema or data is touched.",
            auto_capable=True,
            required_payload_keys=frozenset({"connection_id"}),
            execute=_exec_drift_rescan,
        ),
        ActionSpec(
            action_type="mapping_suggestions_refresh",
            description="Regenerate AI mapping suggestions for a draft mapping",
            risk="low",
            reversible=True,
            reversibility_note="Creates pending suggestions the user can reject; drafts only — publish state is never touched.",
            auto_capable=True,
            required_payload_keys=frozenset({"mapping_id"}),
            execute=_exec_mapping_suggestions_refresh,
        ),
        ActionSpec(
            action_type="migration_execute",
            description="Run the legacy autopilot migration (copies rows into the target connection)",
            risk="high",
            reversible=False,
            reversibility_note="NOT reversible: writes rows into the target database. Requires explicit human approval; never runs autonomously.",
            auto_capable=False,
            required_payload_keys=frozenset({"source_id", "target_id"}),
            execute=_exec_migration_execute,
        ),
    )
}

# TRD §2/§11: hard-blocked irrespective of any policy row (AC3). The
# default-deny registry already refuses these; naming them gives an explicit,
# testable "prohibited regardless of policy configuration" refusal.
PROHIBITED_ACTION_TYPES: FrozenSet[str] = frozenset({
    "connection_delete",
    "connection_hard_delete",
    "mapping_publish",
    "user_role_change",
    "credential_change",
    "security_setting_change",
    "ddl_execute",
})

# Import-time invariants: the autonomous surface can only contain reversible,
# low-risk actions, and nothing prohibited can ever be registered.
for _spec in ACTION_REGISTRY.values():
    assert not (_spec.auto_capable and not _spec.reversible), (
        f"{_spec.action_type}: auto_capable requires reversible"
    )
    assert not (_spec.auto_capable and _spec.risk != "low"), (
        f"{_spec.action_type}: auto_capable requires low risk"
    )
    assert _spec.action_type not in PROHIBITED_ACTION_TYPES, (
        f"{_spec.action_type}: prohibited actions can never be registered"
    )


def check_action_allowed(action_type: str) -> ActionSpec:
    """Server-side guardrail gate. Raises for prohibited/unknown types."""
    if action_type in PROHIBITED_ACTION_TYPES:
        raise ProhibitedActionError(
            f"action '{action_type}' is prohibited regardless of policy configuration"
        )
    spec = ACTION_REGISTRY.get(action_type)
    if spec is None:
        raise UnknownActionError(
            f"action '{action_type}' is not in the Autopilot allow-list (default deny)"
        )
    return spec


def validate_payload(spec: ActionSpec, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + normalize a payload against the spec (boundary validation)."""
    if not isinstance(payload, dict):
        raise PayloadValidationError("payload must be an object")
    missing = spec.required_payload_keys - payload.keys()
    if missing:
        raise PayloadValidationError(
            f"payload missing required keys: {sorted(missing)}"
        )
    normalized = dict(payload)
    for key in spec.required_payload_keys:
        if key.endswith("_id"):
            try:
                normalized[key] = int(normalized[key])
            except (TypeError, ValueError) as exc:
                raise PayloadValidationError(
                    f"payload key '{key}' must be an integer"
                ) from exc
    return normalized
