# Task #7 — Dependency-aware soft delete with warnings (CONN-T7)

**TRD reference:** FR7, §10 risk table (silent breakage of dependents), AC3.

**Current state:** `backend/app/api/routers/connectors.py` has `DELETE /connectors/{id}` that performs a hard delete — the row is removed from the database immediately with no dependency checks. If a Mapping or Pipeline references this connection, it will silently break (the FK reference becomes a dangling pointer). There is no warning to the user, no soft-delete mechanism, and no way to recover a deleted connection.

## Scope

Replace hard delete with a soft-delete flow that:
1. Checks for dependent Mappings and Pipelines.
2. Warns the user with a list of dependents.
3. Requires explicit confirmation (a second request with `?confirm=true`).
4. Soft-deletes the connection (sets `is_deleted=True`, `deleted_at=now`).
5. Flags dependent resources as affected (e.g., sets `pipeline.enabled=False` or `mapping.status="connection_deleted"`).

### Dependency check — `backend/app/services/connection_service.py`

Add a method to find all resources that depend on a connection:

**Field names below were verified against the actual models as of 2026-07-06** (an earlier
draft of this task referenced `source_connection_id`/`target_connection_id`/`is_deleted` on
`Mapping`, none of which exist — `Mapping` uses `source_id`/`target_id` and has no `is_deleted`
column, only a nullable `deleted_at`; see `backend/app/models/mapping.py`). `Pipeline` (built
independently under `Pipelines_tasks`) genuinely does use `source_connection_id`/
`target_connection_id`, but likewise has no `is_deleted` — soft-delete on `Pipeline` isn't
implemented, so the dependency check can only look at `enabled`, not a deletion flag:

```python
def get_dependents(db, connection_id: int) -> dict:
    """Find all resources that depend on this connection.
    
    Returns a dict with counts and lists of dependent resources.
    """
    dependents = {
        "mappings": [],
        "pipelines": [],
        "total": 0,
    }

    # Check Mappings (source or target). Field names: Mapping uses source_id/
    # target_id (NOT source_connection_id/target_connection_id), and has no
    # is_deleted column -- use deleted_at.is_(None) instead.
    try:
        from app.models.mapping import Mapping
        mappings = (
            db.query(Mapping)
            .filter(
                or_(
                    Mapping.source_id == connection_id,
                    Mapping.target_id == connection_id,
                ),
                Mapping.deleted_at.is_(None),
            )
            .all()
        )
        dependents["mappings"] = [
            {"id": m.id, "name": m.name, "role": "source" if m.source_id == connection_id else "target"}
            for m in mappings
        ]
    except Exception as e:
        # Mapping model may not exist yet — graceful degradation
        logger.warning("Could not check Mapping dependencies: %s", e)

    # Check Pipelines (source or target). Pipeline genuinely uses
    # source_connection_id/target_connection_id, but has no is_deleted or
    # deleted_at column -- only `enabled` (Integer, 1/0). A disabled
    # pipeline still counts as a dependent (disabling it doesn't remove
    # the FK reference), so it is not filtered out here.
    try:
        from app.models.pipeline import Pipeline
        pipelines = (
            db.query(Pipeline)
            .filter(
                or_(
                    Pipeline.source_connection_id == connection_id,
                    Pipeline.target_connection_id == connection_id,
                ),
            )
            .all()
        )
        dependents["pipelines"] = [
            {"id": p.id, "name": p.name, "role": "source" if p.source_connection_id == connection_id else "target"}
            for p in pipelines
        ]
    except Exception as e:
        # Pipeline model may not exist yet — graceful degradation
        logger.warning("Could not check Pipeline dependencies: %s", e)

    dependents["total"] = len(dependents["mappings"]) + len(dependents["pipelines"])
    return dependents
```

### Soft-delete endpoint — `DELETE /connectors/{id}`

Replace the existing hard-delete with:

```python
@router.delete("/{id}", status_code=200)
def delete_connection(
    id: int,
    confirm: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Soft-delete a connection. If dependents exist, requires ?confirm=true."""
    db_conn = _get_or_404(id, db)

    # Check dependents
    dependents = connection_service.get_dependents(db, id)

    if dependents["total"] > 0 and not confirm:
        # Return warning — user must confirm
        return {
            "warning": f"This connection is used by {dependents['total']} resource(s). "
                       f"Deleting it will affect them.",
            "dependents": dependents,
            "requires_confirm": True,
        }

    # Proceed with soft delete
    connection_service.soft_delete_connection(db, id, actor=getattr(_user, "email", "unknown"))

    # Flag dependent resources
    for mapping in dependents["mappings"]:
        _flag_mapping_affected(db, mapping["id"])
    for pipeline in dependents["pipelines"]:
        _flag_pipeline_affected(db, pipeline["id"])

    record_audit(db, "connector_deleted", connection_id=id, connection_name=db_conn.name,
                 payload={"dependents_count": dependents["total"], "soft_delete": True})

    db.commit()
    return {
        "status": "deleted",
        "id": id,
        "name": db_conn.name,
        "affected_dependents": dependents["total"],
    }
```

### Flagging dependent resources

When a connection is soft-deleted, its dependents need to be notified:

- **Mappings:** Set a `connection_status` field (or a `warning` flag) on the Mapping to indicate its source/target connection is gone. The Schema Mapper UI should display a banner: "Source connection 'prod-db' has been deleted. This mapping may not function."
- **Pipelines:** Set `enabled=False` on any Pipeline that uses this connection, with a `disabled_reason` field: "Source connection 'prod-db' was deleted on 2026-07-06."

These flagging operations should be best-effort — if the Mapping or Pipeline model doesn't have the expected fields, log a warning and continue.

### Recovery (undelete)

Add `POST /connectors/{id}/restore` to undo a soft-delete:

```python
@router.post("/{id}/restore")
def restore_connection(id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Restore a soft-deleted connection."""
    db_conn = db.query(DBConnection).filter(
        DBConnection.id == id,
        DBConnection.is_deleted == True,
    ).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Deleted connection not found")

    connection_service.restore_connection(db, id, actor=getattr(_user, "email", "unknown"))
    record_audit(db, "connector_restored", connection_id=id, connection_name=db_conn.name)

    db.commit()
    return {"status": "restored", "id": id, "name": db_conn.name}
```

### Hard delete (admin only)

Add `DELETE /connectors/{id}/hard` for admin cleanup of soft-deleted connections. This permanently removes the row and the associated secrets:

**`require_role` usage below was corrected 2026-07-06** — an earlier draft called
`require_role(_user, "admin")` as a plain function inside the route body. The real
`require_role(*allowed)` (`backend/app/api/deps.py`) is a dependency *factory*: it returns a
FastAPI dependency callable and must be used as `Depends(require_role("admin"))` in the endpoint
signature (see `mappings.py`'s `delete_mapping` for the established pattern), not invoked inline
with a `User` object as if it were one of the allowed-role strings.

```python
@router.delete("/{id}/hard", status_code=204)
def hard_delete_connection(
    id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    """Permanently delete a soft-deleted connection. Admin only."""
    db_conn = db.query(DBConnection).filter(DBConnection.id == id).first()
    if not db_conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Delete secrets from vault
    if db_conn.secrets_ref:
        from app.services.secret_manager import get_secret_manager
        get_secret_manager().delete(db_conn.secrets_ref)

    # Delete the connection secret row
    from app.models.connection_secret import ConnectionSecret
    db.query(ConnectionSecret).filter(ConnectionSecret.connection_id == id).delete()

    # Hard delete the connection
    db.delete(db_conn)
    record_audit(db, "connector_hard_deleted", connection_id=id, connection_name=db_conn.name)
    db.commit()
```

### List deleted connections

Add `GET /connectors/deleted` to list soft-deleted connections (admin view):

```python
@router.get("/deleted")
def list_deleted_connections(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    """List soft-deleted connections. Admin only."""
    return db.query(DBConnection).filter(DBConnection.is_deleted == True).all()
```

## Dependencies

- Task #1 (model upgrade: `is_deleted`, `deleted_at` columns).
- Schema Mapper's `Mapping` model (already exists in `backend/app/models/mapping.py`).
- Pipelines' `Pipeline` model (may not exist yet — graceful degradation).

## Edge cases

- **Dependent model doesn't exist yet:** The `get_dependents` method catches `ImportError` and `Exception` for each model check independently. If the Pipeline model hasn't been built yet, it logs a warning and returns only Mapping dependents. The delete proceeds with partial information.
- **Connection already soft-deleted:** `DELETE /connectors/{id}` on an already-deleted connection returns 404 (the `_get_or_404` filters `is_deleted=False` by default). Use `GET /connectors/deleted` to find it, then `POST /connectors/{id}/restore` to recover.
- **Restore with still-broken dependents:** If a connection is restored but its dependent Mappings/Pipelines were manually deleted in the meantime, the restore still succeeds. The dependent resources' flags are not automatically cleared — the user should re-enable them manually.
- **Name collision on restore:** If a new connection was created with the same name as the soft-deleted one, restoring the old one would violate the unique constraint. The restore should either: (a) reject with a 409 conflict, or (b) auto-rename the restored connection (e.g., "prod-db (restored)"). Prefer (a) — the user can rename manually.
- **Hard delete with active dependents:** Hard delete should be blocked if the connection still has active (non-deleted) dependents. Only allow hard delete on connections that have no active dependents or whose dependents have also been deleted.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that `DELETE /connectors/{id}` with no dependents soft-deletes the connection.
- Test that `DELETE /connectors/{id}` with dependents returns a warning and requires `?confirm=true`.
- Test that `DELETE /connectors/{id}?confirm=true` with dependents soft-deletes and flags dependents.
- Test that `GET /connectors/` does not return soft-deleted connections.
- Test that `GET /connectors/{id}` on a soft-deleted connection returns 404.
- Test that `POST /connectors/{id}/restore` restores a soft-deleted connection.
- Test that `DELETE /connectors/{id}/hard` permanently removes the connection and secrets.
- Test that hard delete is blocked if the connection has active dependents.
- Test that restore with a name conflict returns 409.

## Risk

Low-medium. The dependency check is best-effort (graceful degradation if models don't exist). The main risk is a user accidentally confirming a delete without understanding the consequences — mitigated by the two-step confirm flow and the audit trail. The hard-delete admin gate prevents accidental permanent data loss.