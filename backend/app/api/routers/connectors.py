import logging
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.connection import DBConnection
from app.models.user import User
from app.schemas.connection import (
    ConnectionCreate,
    ConnectionResponse,
    ConnectorTypeMetadata,
    HealthSummary,
    TestConnectionResponse,
    TestDiagnostics,
    TestErrorDetail,
)
from app.services import connector_catalog
from app.services.audit_helper import record_audit
from app.services.connection_service import ConnectionService
from app.services.schema_service import SchemaService

logger = logging.getLogger(__name__)
router = APIRouter()


def _actor(user) -> str:
    return getattr(user, "email", None) or "system"


def _to_response(conn: DBConnection) -> ConnectionResponse:
    """Single choke point for serializing a connection — always redacts
    secret config values (TRD FR3: secrets are never returned after save)."""
    return ConnectionResponse(
        id=conn.id,
        name=conn.name,
        type=conn.type,
        config=connector_catalog.redact_config(conn.type, conn.config),
        health_status=conn.health_status or "unknown",
        last_tested_at=conn.last_tested_at,
        last_test_error=conn.last_test_error,
        is_deleted=bool(conn.is_deleted),
        created_by=conn.created_by,
        created_at=conn.created_at,
    )


# ── Static routes (must precede /{id}) ─────────────────────────

@router.get("/types", response_model=Dict[str, ConnectorTypeMetadata])
def list_connector_types(_user: User = Depends(get_current_user)):
    """All supported connector types with field metadata for dynamic forms (FR1)."""
    return connector_catalog.CONNECTOR_TYPES


@router.get("/types/{type}", response_model=ConnectorTypeMetadata)
def get_connector_type(type: str, _user: User = Depends(get_current_user)):
    """Metadata for a single connector type."""
    return connector_catalog.get_type_or_404(type)


@router.get("/health-summary", response_model=HealthSummary)
def health_summary(db: Session = Depends(get_db),
                   _user: User = Depends(get_current_user)):
    """Aggregate health counts across non-deleted connections (FR5)."""
    return ConnectionService.health_summary(db)


@router.get("/deleted", response_model=List[ConnectionResponse])
def list_deleted_connections(db: Session = Depends(get_db),
                             _user: User = Depends(require_role("admin"))):
    """Soft-deleted connections (admin only)."""
    return [_to_response(c) for c in ConnectionService.list_deleted(db)]


# ── CRUD ────────────────────────────────────────────────────────

@router.post("/", response_model=ConnectionResponse, status_code=201)
def create_connection(conn: ConnectionCreate, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Create a new database connector (config validated against the type
    catalog; secret values never appear in the response)."""
    created = ConnectionService.create_connection(
        db, name=conn.name, conn_type=conn.type, config=conn.config,
        actor=_actor(user),
    )
    return _to_response(created)


@router.get("/", response_model=List[ConnectionResponse])
def list_connections(db: Session = Depends(get_db),
                     _user: User = Depends(get_current_user)):
    """List all configured (non-deleted) database connectors."""
    return [_to_response(c) for c in ConnectionService.list_connections(db)]


@router.get("/{id}", response_model=ConnectionResponse)
def get_connection(id: int, db: Session = Depends(get_db),
                   _user: User = Depends(get_current_user)):
    """Get connection details by ID (404 for soft-deleted rows)."""
    return _to_response(ConnectionService.get_connection(db, id))


@router.delete("/{id}")
def delete_connection(id: int, confirm: bool = Query(False),
                      db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Soft-delete a connector (FR7). If mappings/pipelines depend on it,
    the first call returns a warning; repeat with ?confirm=true to proceed.
    Dependent pipelines are disabled, dependents recorded in the audit trail."""
    db_conn = ConnectionService.get_connection(db, id)
    dependents = ConnectionService.get_dependents(db, id)

    if dependents["total"] > 0 and not confirm:
        return {
            "warning": (
                f"This connection is used by {dependents['total']} resource(s). "
                "Deleting it will disable dependent pipelines and break dependent "
                "mappings. Repeat the request with ?confirm=true to proceed."
            ),
            "dependents": dependents,
            "requires_confirm": True,
        }

    ConnectionService.soft_delete_connection(db, id, actor=_actor(user),
                                             dependents=dependents)
    return {
        "status": "deleted",
        "id": id,
        "name": db_conn.name,
        "affected_dependents": dependents["total"],
    }


@router.post("/{id}/restore", response_model=ConnectionResponse)
def restore_connection(id: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Restore a soft-deleted connection (409 if its name was reused)."""
    return _to_response(
        ConnectionService.restore_connection(db, id, actor=_actor(user))
    )


@router.delete("/{id}/hard", status_code=204)
def hard_delete_connection(id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_role("admin"))):
    """Permanently delete a connection (admin only; blocked while dependents exist)."""
    ConnectionService.hard_delete_connection(db, id, actor=_actor(user))


# ── Credential vaulting (keeperdb_integration_tasks #5/#6) ─────


@router.post("/migrate-secrets")
def migrate_secrets(db: Session = Depends(get_db),
                    user: User = Depends(require_role("admin"))):
    """One-time, idempotent backfill: move legacy plaintext secrets out of
    the config column into the vault. Explicit and admin-triggered — NEVER a
    side effect of a read (connector_tasks #2's corrected design). Re-running
    is a no-op."""
    from app.services.connection_secrets_service import migrate_plaintext_secrets
    return migrate_plaintext_secrets(db, actor=_actor(user))


@router.post("/{id}/rotate-credentials")
def rotate_credentials(id: int, body: dict, db: Session = Depends(get_db),
                       user: User = Depends(require_role("admin"))):
    """Rotate a connection's credentials via the vault. The response never
    echoes secret values — field names only. Body validated manually so a
    malformed request can't bounce secrets back in a 422 echo."""
    secrets = (body or {}).get("secrets")
    if (not isinstance(secrets, dict) or not secrets
            or not all(isinstance(v, str) and v for v in secrets.values())):
        # Deliberately does NOT echo the received body (connector_tasks #2's
        # 422-echo risk note).
        raise HTTPException(
            status_code=422,
            detail="body must be {\"secrets\": {\"<field>\": \"<value>\"}} with "
                   "non-empty string values (values not echoed)",
        )
    from app.services.connection_secrets_service import rotate_credentials as _rotate
    return _rotate(db, id, secrets, actor=_actor(user))


# ── Test / schema / discovery ──────────────────────────────────

@router.post("/{id}/test", response_model=TestConnectionResponse)
def test_connection(id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Test connectivity with structured diagnostics and a hard timeout
    (FR4). Also updates the stored health status and emits an audit event."""
    db_conn = ConnectionService.get_connection(db, id)
    result = SchemaService.test_connection(db_conn)
    status = "connected" if result.success else "failed"

    if result.success:
        health = "healthy"
    elif result.reachable:
        health = "degraded"
    else:
        health = "down"
    ConnectionService.update_health(db, id, health, result.error_message)

    logger.info("[connectors] stage=test id=%d status=%s code=%s latency_ms=%s",
                id, status, result.error_code, result.latency_ms)
    record_audit(db, "connector_tested", actor=_actor(user),
                 connection_id=id, connection_name=db_conn.name,
                 status="success" if result.success else "failure",
                 duration_ms=result.latency_ms,
                 payload={"status": status, "error_code": result.error_code})
    db.commit()

    return TestConnectionResponse(
        id=id,
        name=db_conn.name,
        status=status,
        diagnostics=TestDiagnostics(
            reachable=result.reachable,
            authenticated=result.authenticated,
            database_accessible=result.database_accessible,
            version=result.version,
            latency_ms=result.latency_ms,
        ),
        error=TestErrorDetail(code=result.error_code or "UNKNOWN_ERROR",
                              message=result.error_message or "Connection test failed")
        if not result.success else None,
    )


@router.get("/{id}/schema")
def get_schema(id: int, db: Session = Depends(get_db),
               _user: User = Depends(get_current_user)):
    """Extract full structural schema metadata from the connector."""
    db_conn = ConnectionService.get_connection(db, id)
    try:
        schema_data = SchemaService.get_full_schema(db_conn)
        return {"id": id, "name": db_conn.name, "schema": schema_data}
    except Exception as e:
        logger.error("Schema extraction failed for connector %d: %s", id, e)
        raise HTTPException(status_code=500, detail=f"Schema extraction failed: {str(e)}")


@router.post("/{id}/discover")
def discover_schema(id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Trigger schema discovery (FR8): snapshot the current schema for
    drift detection and hand off to Schema Intel's catalog scan."""
    import hashlib
    import json

    db_conn = ConnectionService.get_connection(db, id)
    actor = _actor(user)

    try:
        schema_data = SchemaService.get_full_schema(db_conn)
    except Exception as e:
        logger.error("[connectors] stage=discover id=%d failed: %s", id, e)
        record_audit(db, "discovery_failed", actor=actor,
                     connection_id=id, connection_name=db_conn.name,
                     status="failure", payload={"error": str(e)})
        db.commit()
        raise HTTPException(status_code=500, detail=f"Schema discovery failed: {str(e)}")

    from app.models.schema_snapshot import SchemaSnapshot
    normalized = json.dumps(schema_data, sort_keys=True, default=str)
    snapshot = SchemaSnapshot(
        connection_id=id,
        connection_name=db_conn.name,
        schema_hash=hashlib.sha256(normalized.encode()).hexdigest(),
        schema_json=schema_data,
    )
    db.add(snapshot)
    db.flush()

    # Handoff to Schema Intel's catalog (best-effort — discovery still
    # succeeds if the catalog scan fails). Note scan_connection commits,
    # which also persists the snapshot staged above.
    catalog_scan = None
    try:
        from app.services.schema_catalog_service import SchemaCatalogService
        catalog_scan = SchemaCatalogService.scan_connection(db, id, actor=actor)
    except ImportError:
        logger.info("[connectors] Schema Intel catalog not available — skipping handoff")
    except Exception as e:
        logger.warning("[connectors] Schema Intel catalog scan failed (non-fatal): %s", e)

    logger.info("[connectors] stage=discover id=%d tables=%d catalog_handoff=%s",
                id, len(schema_data), bool(catalog_scan))
    record_audit(db, "discovery_completed", actor=actor,
                 connection_id=id, connection_name=db_conn.name,
                 payload={"tables": len(schema_data), "snapshot_id": snapshot.id,
                          "catalog_handoff": bool(catalog_scan)})
    db.commit()

    return {
        "id": id,
        "name": db_conn.name,
        "tables": len(schema_data),
        "snapshot_id": snapshot.id,
        "catalog_scan": catalog_scan,
        "tables_discovered": sorted(schema_data.keys()),
    }
