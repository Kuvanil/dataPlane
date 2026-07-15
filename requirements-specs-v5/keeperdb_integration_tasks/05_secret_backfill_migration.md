# Task #5 — One-time, idempotent backfill of plaintext secrets

**Reference:** TRD §5 FR5, §11 Risks. Depends on #4 (the write path must exist before old rows
migrate to it).

**Goal:** Move every existing connection's plaintext secret out of `config` and into the vault,
exactly once, explicitly — repeating `connector_tasks#2`'s own corrected guidance verbatim, since
it already caught and fixed this exact mistake once in an earlier draft.

## Changes

- Implement as **either** a startup migration step (iterate all connections with
  `secrets_ref is None` and migrate them before the app starts serving traffic) **or** a dedicated
  admin-triggered endpoint (`POST /connectors/{id}/migrate-secrets` or a bulk
  `POST /connectors/migrate-secrets`) — pick one, do not implement both as independent code paths
  that could race each other.
- **Do not** trigger migration as a side effect of `GET /connectors/{id}` or any other read —
  reads must stay idempotent and side-effect-free.
- If implemented as an admin endpoint instead of a startup step, use `INSERT ... ON CONFLICT`
  (upsert) or the existing unique constraint on `connection_id` (the `ConnectionSecret`-equivalent
  table backing whichever backend Task #2 selected) to deduplicate concurrent calls.
- `sqlite` connections (no secrets) are skipped — no-op, not an error.
- Migration is logged (`logger.info("[secrets] migrated connection_id=...")`) without ever logging
  the secret value.

## Tests

- `backend/tests/secrets/test_backfill_migration.py`:
  - A connection with a plaintext secret in `config` → after backfill, `secrets_ref` is populated
    and `config` no longer contains the secret value.
  - Running the backfill twice on the same connection is a no-op the second time (idempotency).
  - `sqlite` connections pass through untouched.
  - Concurrent backfill calls on the same connection (if implemented as an endpoint) don't create
    duplicate vault records — verify via the upsert/unique-constraint behavior.

## Verify

```bash
cd backend && pytest tests/secrets/test_backfill_migration.py -v
```

## Risk

- Medium — the exact failure mode already caught once in `connector_tasks#2`'s own history (an
  earlier draft made this an implicit `GET` side effect). This task's job is specifically to not
  repeat that mistake — idempotency and explicitness are the whole point, not an afterthought.
