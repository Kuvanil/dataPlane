# Keeper Secrets Manager Integration — Validation Bugs

Validated and fixed 2026-07-15.

## BUG-01 — Test package shadows Python standard library `secrets`

- Severity: High (validation/release blocker)
- Reproduction: run backend pytest with Python 3.13. Starlette imports
  `secrets.token_hex`, but Python resolves `backend/tests/secrets/__init__.py`
  instead of the standard-library module, so collection aborts before tests run.
- Fix: removed the unnecessary `backend/tests/secrets/__init__.py` package marker.
- Verification: v3 (81), v4 (50), and v5 (41) targeted tests collect and pass.

## BUG-02 — Partial rotation could erase credentials after a vault read failure

- Severity: Critical (credential integrity)
- Cause: `rotate_credentials()` caught every `SecretManagerError` from retrieving the
  existing record, substituted `{}`, and then rotated using only the submitted fields.
  A lost AES key or Keeper outage during a one-field rotation could therefore discard
  the remaining credential fields.
- Fix: retrieval now fails closed. Rotation is not attempted unless the current record
  is successfully read and merged.
- Regression test: `test_rotate_fails_closed_when_existing_secret_cannot_be_read`.
