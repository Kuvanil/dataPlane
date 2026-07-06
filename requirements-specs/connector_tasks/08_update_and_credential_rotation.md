# Task #8 — Update connection + credential rotation + audit (CONN-T1/T8, update half)

**TRD reference:** FR6, FR9 (audit for edit/rotate), Security NFR, §11 API: `PUT /connectors/{id}`.

**Current state:** There is no `PUT /connectors/{id}` endpoint. Users cannot edit connection parameters without deleting and recreating the connection. There is no credential rotation flow — if a database password changes, there is no way to update it without the full recreate cycle. Audit events exist for create/delete/test but not for edit or rotate actions.

## Scope

Build update and credential rotation endpoints with proper vault integration and audit.

### Update endpoint — `PUT /connectors/{id}`

```python
@router.put("/{id}", response_model=ConnectionResponse)
def update_connection(
    id: int,
    payload: ConnectionUpdate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Update non-secret connection parameters."""
    db_conn = _get_or_404(id, db)

    # Validate name uniqueness if name is being changed
    if payload.name and payload.name != db_conn.name:
        if not _NAME_RE.match(payload.name):
            raise HTTPException(status_code=422, detail="Invalid name format")
        existing = db.query(DBConnection).filter(
            DBConnection.name == payload.name,
            DBConnection.id != id,
            DBConnection.is_deleted == False,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"A connector named '{payload.name}' already exists")

    # Update non-secret fields only (config without secret fields)
    if payload.config is not None:
        secret_fields = CONNECTOR_TYPES.get(db_conn.type, {}).secret_fields or []
        # Filter out any secret fields that were accidentally included
        sanitized_config = {k: v for k, v in payload.config.items() if k not in secret_fields}
        # Merge with existing config (preserve existing non-secret fields not in update)
        current_config = dict(db_conn.config or {})
        current_config.update(sanitized_config)
        db_conn.config = current_config

    if payload.name is not None:
        db_conn.name = payload.name

    db_conn.updated_at = datetime.utcnow()
    db_conn.updated_by = getattr(_user, "email", "unknown")

    record_audit(db, "connector_updated", connection_id=id, connection_name=db_conn.name,
                 payload={"fields_updated": list(payload.config.keys()) if payload.config else []})

    db.commit()
    db.refresh(db_conn)
    return db_conn
```

### Credential rotation endpoint — `POST /connectors/{id}/rotate-credentials`

The rotation flow follows a "test then commit" two-phase pattern:

```python
@router.post("/{id}/rotate-credentials")
def rotate_credentials(
    id: int,
    payload: CredentialRotation,
    test_first: bool = Query(True),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Rotate credentials for a connection.

    By default (test_first=True), the new credentials are tested before being
    saved. If the test fails, the old credentials are preserved.
    """
    db_conn = _get_or_404(id, db)
    secret_fields = CONNECTOR_TYPES.get(db_conn.type, {}).secret_fields or []

    # Validate that the payload contains only secret fields
    for key in payload.secrets:
        if key not in secret_fields:
            raise HTTPException(
                status_code=422,
                detail=f"'{key}' is not a recognized secret field for connector type '{db_conn.type}'",
            )

    # Phase 1: Test with new credentials (if test_first=True)
    if test_first:
        _test_credentials(db_conn, payload.secrets)

    # Phase 2: Store new credentials in vault
    from app.services.secret_manager import get_secret_manager
    secret_manager = get_secret_manager()

    if db_conn.secrets_ref:
        new_ref = secret_manager.rotate(db_conn.secrets_ref, payload.secrets)
    else:
        new_ref = secret_manager.store(db_conn.id, payload.secrets)

    db_conn.secrets_ref = new_ref
    db_conn.updated_at = datetime.utcnow()
    db_conn.updated_by = getattr(_user, "email", "unknown")

    record_audit(db, "connector_credentials_rotated", connection_id=id, connection_name=db_conn.name,
                 payload={"secret_fields_rotated": list(payload.secrets.keys())})

    db.commit()
    db.refresh(db_conn)
    return {"status": "rotated", "id": id, "name": db_conn.name}
```

The `_test_credentials` helper builds a temporary connector config from the existing non-secret config + the new secrets, runs `test_connection()`, and raises 400 if it fails:

**Corrected 2026-07-06:** an earlier draft called `get_connector(db_conn.type)(config)`. The real
`get_connector(connection: DBConnection)` (`backend/app/services/schema_service.py`) takes the
whole ORM object and reads `.type`/`.config` itself — it doesn't accept a bare type string, and
there's no separate class returned to instantiate. Same fix as Task #5: swap `db_conn.config` to
the merged (untested) secrets in-memory only, inside a `try`/`finally` that restores the original
value before returning, so the new credentials are never visible outside this function and can
never end up flushed to the row by an autoflush mid-request.

```python
def _test_credentials(db_conn: DBConnection, new_secrets: dict):
    """Build a connector with the new secrets and test connectivity."""
    from app.services.schema_service import get_connector

    config = dict(db_conn.config or {})
    config.update(new_secrets)

    original_config = db_conn.config
    try:
        db_conn.config = config
        connector = get_connector(db_conn)
        result = connector.test_connection()
        connector.close()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Credential test failed: {str(e)}",
        )
    finally:
        db_conn.config = original_config

    if not result.success:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Credential test failed — existing credentials preserved",
                "error_code": result.error_code,
                "error_detail": result.error_message,
            },
        )
```

### Credential rotation skip test flag

The `test_first=False` query parameter allows force-rotation without testing. This is useful when:
- The target database is temporarily unreachable but you know the new credentials are correct.
- You need to rotate credentials proactively before a password expiry.

When `test_first=False`, log a warning: "Credential rotation for connection {id} skipped test phase — relying on operator assurance."

### Audit coverage

Update the audit emission to cover all 5 connector actions per FR9:

| Action | Audit event | Status |
|--------|-------------|--------|
| Create | `connector_created` | Already exists |
| Edit | `connector_updated` | **New** (this task) |
| Delete | `connector_deleted` | Already exists (updated to soft-delete in Task #7) |
| Test | `connector_tested` | Already exists (enhanced in Task #4) |
| Rotate | `connector_credentials_rotated` | **New** (this task) |
| Restore | `connector_restored` | **New** (Task #7) |
| Hard Delete | `connector_hard_deleted` | **New** (Task #7) |
| Discovery | `discovery_completed` / `discovery_failed` | **New** (Task #6) |

### Input schemas

Add to `backend/app/schemas/connection.py`:

```python
class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None

class CredentialRotation(BaseModel):
    secrets: dict  # e.g., {"password": "new_secure_password"}
```

### Router reorganization

The `connectors.py` router is growing beyond a single file. Consider splitting into:

- `connectors.py` — CRUD (create, list, get, update, delete, restore)
- `connectors_test.py` — test/discovery operations (test, discover, health-summary)
- `connectors_secrets.py` — credential operations (rotate, secret-fields)

This split is optional but recommended as the router approaches 15+ endpoints.

## Dependencies

- Task #1 (model upgrade: `updated_at`, `updated_by` columns).
- Task #2 (secret manager: `store`, `rotate`, `retrieve` methods).
- Task #3 (connector catalog: `secret_fields` mapping per type).
- Task #4 (test connection: `_test_credentials` helper uses `test_connection()`).

## Edge cases

- **Rotate without existing secrets_ref:** A connection created before Task #2 (secrets in config, no `secrets_ref`) should already have been migrated by Task #2's one-time backfill (startup step or admin endpoint — see that task's corrected design, 2026-07-06). If `secrets_ref` is still `None` at rotation time regardless, call the same backfill function Task #2 defines rather than re-implementing the extract-and-migrate logic here.
- **Rotate on SQLite (no secrets):** SQLite connectors have no secret fields. Calling rotate should return 422 with "SQLite connections have no credentials to rotate."
- **Update config with secret fields:** If a user includes secret fields in the update payload's `config` (e.g., `{"password": "new"}` in the non-secret config update), the service should strip them and log a warning. The update endpoint should never write secrets to `config` — only the rotate endpoint writes to the vault.
- **Concurrent update and rotate:** If a user updates the connection name while another rotates credentials, the last-writer-wins on `updated_at` but the two operations touch different columns (config vs secrets_ref) so they don't conflict. Use the service layer's session to serialize per-connection updates.
- **Rotate with failed test and existing dependents:** If credential rotation fails because the new credentials are wrong, existing dependents (pipelines, mappings) continue working with the old credentials. The connection remains "healthy" or "degraded" with a note that a rotation attempt was made and failed.
- **Audit payload size:** The rotate audit event includes the list of rotated field names, not the values. Never log or audit the actual credential values.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that `PUT /connectors/{id}` updates non-secret fields.
- Test that `PUT /connectors/{id}` strips secret fields from config.
- Test that `PUT /connectors/{id}` with a duplicate name returns 409.
- Test that `POST /connectors/{id}/rotate-credentials` with valid new secrets succeeds.
- Test that `POST /connectors/{id}/rotate-credentials` with invalid new secrets fails and preserves old secrets.
- Test that `POST /connectors/{id}/rotate-credentials?test_first=false` skips the test.
- Test that `POST /connectors/{id}/rotate-credentials` on a SQLite connection returns 422.
- Test that rotating on an unmigrated connection (no secrets_ref) automatically backfills.
- Test that audit events are emitted for both update and rotate with correct action names.

## Risk

Low-medium. The credential rotation flow has safety rails (test-before-commit by default, 400 on failure, no secrets in audit logs). The main risk is a user setting `test_first=false` with bad credentials and breaking production pipelines — mitigated by the warning log and audit trail that records who performed the rotation and whether the test was skipped.