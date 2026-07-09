# Bug 05: Secret manager (#2) not implemented — credentials stored in plaintext at rest

- **Severity:** High (correctly [!] blocked on sign-off)
- **File:** `backend/app/services/` — no `secret_manager.py` exists
- **Status:** Correctly blocked — pending encryption approach sign-off

## Description

Task #2 defines a `SecretManager` abstraction with `store`, `retrieve`, `rotate`, `delete` methods and an AES-256-GCM envelope encryption implementation. None of this exists in the codebase. Credentials are stored in plaintext in the `config` JSON column of the `connections` table.

## What's Missing

1. **`backend/app/services/secret_manager.py`** — the entire abstraction layer.
2. **`backend/app/models/connection_secret.py`** — the `ConnectionSecret` model for encrypted storage.
3. **Encryption logic** — AES-256-GCM envelope encryption with `SECRETS_ENCRYPTION_KEY` env var.
4. **Backfill migration** — one-time migration of existing plaintext secrets to vault.
5. **`secrets_ref` population** — the model has the column but it's always `None`.

## Mitigations Already in Place

The INDEX.md correctly notes the interim mitigations shipped 2026-07-07:
- Response-layer redaction via `redact_config()` in `connector_catalog.py`
- Auth-gated reads (all endpoints require authentication)
- `_FALLBACK_SECRET_KEYS` set masks known secret patterns even for unknown types

## Impact

- **FR3 not met:** "Credentials shall be submitted to a secret manager and never returned to the client after save" — the "never returned" half is done, but "stored in vault" is not.
- **Security risk:** A database dump or SQL injection reveals all connection passwords in plaintext.
- **FR6 blocked:** Credential rotation (#8) cannot be implemented without the vault.

## Detection

```bash
# Confirm no secret_manager.py exists
ls backend/app/services/secret_manager.py  # should show "No such file"
# Confirm secrets_ref is always null in the DB
# SELECT secrets_ref FROM connections; -- all NULL