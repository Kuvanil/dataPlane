# Bug 04: `PUT /connectors/{id}` and credential rotation (#8) completely missing from code

- **Severity:** High (correctly [!] blocked on #2)
- **File:** `backend/app/api/routers/connectors.py` — no `PUT` endpoint exists
- **Status:** Correctly blocked — requires #2 (secret manager) first

## Description

Task #8 in the connector spec defines `PUT /connectors/{id}` (update non-secret fields) and `POST /connectors/{id}/rotate-credentials` (credential rotation). Neither endpoint exists in the codebase. There is no `ConnectionUpdate` schema, no `CredentialRotation` schema, and no rotation logic anywhere.

## What's Missing

1. **Update endpoint:** `PUT /connectors/{id}` — users cannot edit connection parameters without deleting and recreating.
2. **Credential rotation endpoint:** `POST /connectors/{id}/rotate-credentials` — no way to update passwords/API keys without full recreate.
3. **`ConnectionUpdate` schema** — no Pydantic model for partial updates.
4. **`CredentialRotation` schema** — no Pydantic model for secret rotation payload.
5. **Audit events** — `connector_updated` and `connector_credentials_rotated` are not emitted (FR9 partial).

## Status

This is correctly marked as `[!]` blocked in the INDEX.md. It depends on Task #2 (secret manager) because credential rotation needs the vault. Until #2 is signed off, this gap remains.

## Impact

- **FR6 not met:** Users cannot edit connections or rotate credentials.
- **FR9 partial:** `connector_updated` and `connector_credentials_rotated` audit events don't exist.
- **Operational burden:** Changing a database password requires deleting and recreating the connection, losing its history and dependent associations.