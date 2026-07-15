# Task #6 — Credential rotation delegated to KSM

**Reference:** TRD §5 FR6. Resolves `requirements-specs/connector_tasks/08_update_and_credential_rotation.md`,
which has been `[!]` blocked on `connector_tasks#2` since 2026-07-06. Depends on #3 (KSM adapter)
and #4 (`ConnectionService` wiring).

**Goal:** Implement `rotate_credentials()` as a thin call into `SecretManager.rotate()`, letting
KSM's own centralized rotation do the real work — "rotate once in the vault, everyone gets the new
value" — instead of dataPlane building bespoke per-connector-type rotation logic.

## Changes

### `backend/app/services/connection_service.py`

- `rotate_credentials(connection_id: int, new_secrets: dict) -> None`:
  1. Look up the connection's `secrets_ref`.
  2. Call `get_secret_manager().rotate(secrets_ref, new_secrets)`.
  3. If the backend returns a new ref (some backends may re-key on rotation; KSM's record UID is
     stable, so this is a no-op for KSM specifically, but the method must handle a changed ref for
     backend-agnosticism), update `DBConnection.secrets_ref`.
  4. Emit an audit event (Task #8) — actor, connection id, timestamp, no secret value.
- Any in-flight connector session using the old credential value continues per the existing
  connection-pooling behavior already in `BaseConnector` — this task does not add active-session
  invalidation, matching the scope `connector_tasks#8` originally defined.

### `backend/app/api/routers/connectors.py`

- `PUT /connectors/{id}/rotate-credentials` (or extend the existing `PUT /connectors/{id}` per
  whatever `connector_tasks#8` already specified for the update endpoint shape — check that file
  before finalizing the route, since #8 partially scoped this already and this task should not
  duplicate/diverge from it) — request body carries new secret values, response never echoes them
  back.

## Tests

- `backend/tests/connectors/test_credential_rotation.py`:
  - Rotating a connection's password updates the vault value; the next `retrieve()` call returns
    the new value, not the old one.
  - The rotation endpoint's response never contains the new secret value (checked the same way
    `connector_tasks#2` already checks 422-echo leakage).
  - Rotating a `sqlite` connection (no secrets) is rejected with a clear error, not a silent no-op.

## Verify

```bash
cd backend && pytest tests/connectors/test_credential_rotation.py -v
```

## Risk

- Low-Medium — thinner than a from-scratch rotation implementation would be, since KSM owns the
  actual rotation mechanics. The remaining risk is entirely in the response-leakage class already
  well-understood from `connector_tasks#2`'s existing mitigations.
