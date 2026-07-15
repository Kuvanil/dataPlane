# Task #4 — Wire `ConnectionService` to the `SecretManager` abstraction

**Reference:** TRD §5 FR3/FR4/FR9, `connector_tasks#2`'s original service-changes plan. Depends
on #1 (interface) and #3 (a working backend to call through it).

**Goal:** Finish the wiring `connector_tasks#2` originally scoped — this task executes that plan
against the now-built abstraction rather than redesigning it.

## Changes

### `backend/app/services/connection_service.py`

- `create_connection()` — extract known secret fields from `config` before storing the rest.
  Known secret fields per connector type (per `connector_tasks#2`, confirmed still accurate
  against today's `connector_catalog.py`):

  | Type | Secret fields |
  |------|---------------|
  | `postgres` | `password` |
  | `mysql` | `password` |
  | `oracle` | `password` |
  | `sqlite` | None (file-path only, no credentials) |

  Call `get_secret_manager().store(connection_id, secrets)` (Task #1's factory), set
  `secrets_ref` on the model. `config` retains only non-secret fields going forward.
- `get_connection()` — assemble response from `config` + metadata only. Continue using the
  existing `redact_config` behavior for any legacy rows not yet backfilled (Task #5) — this task
  does not change the response contract, only where the source of truth for new writes lives.
- `update_connection()` — same extraction + `SecretManager.store()`/`rotate()` for changed secret
  fields; full rotation flow itself is Task #6.
- `delete_connection()` (hard delete only — soft-deleted connections retain their secrets ref per
  existing `connector_tasks#7` behavior) — call `get_secret_manager().delete(secrets_ref)`.
- `sqlite` connections: no `SecretManager` call at all, `secrets_ref` stays `None` (FR9).

### `backend/app/api/routers/connectors.py`

- No HTTP interface changes — `GET /connectors/{id}` continues returning sanitized config exactly
  as it does today; this task only changes where the underlying secret is sourced from.

## Tests

- `backend/tests/connectors/test_connection_service_secrets_wiring.py`:
  - `POST /connectors/` with a password stores via `SecretManager`, not in `config`.
  - `GET /connectors/{id}` still returns `{"password": {"redacted": true}}`.
  - `sqlite` connections create with no `SecretManager` call (mock assertion: not called) and no
    `secrets_ref` set.
  - `DELETE /connectors/{id}` (hard delete) calls `SecretManager.delete()`.
  - Soft-deleted connections retain `secrets_ref` (existing `connector_tasks#7` behavior
    unchanged).

## Verify

```bash
cd backend && pytest tests/connectors/ -v
```

## Risk

- Medium — this touches the live connector create/read/update/delete paths directly. Mitigated by
  the fact that the field-by-field extraction plan was already reviewed in `connector_tasks#2`;
  this task implements a known-good design rather than inventing one, and the existing 260/260
  passing connector test suite (per `connector_tasks/INDEX.md`) provides a regression baseline.
