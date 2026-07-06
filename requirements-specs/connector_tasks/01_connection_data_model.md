# Task #1 — Connection data model upgrade (CONN-T1, model half)

**TRD reference:** FR2, FR5, FR7, §11 Data model (`Connector`, `ConnectionConfig`, `SecretRef`, `HealthStatus`), §12 DoD.

**Current state:** `backend/app/models/connection.py` has a minimal `DBConnection` model with only `id`, `name`, `type`, `config` (plain JSON), and `created_at`. There is no `tenant_id`, no `health_status`, no `deleted_at`/`is_deleted` for soft-delete, no `updated_at`/`updated_by`, and no `last_tested_at`. Credentials (passwords, API keys) are stored in plaintext in the `config` JSON column — this is addressed in Task #2 but the model needs to anticipate a `secrets_ref` field.

## ⚠️ Decision needed before implementing `tenant_id` (2026-07-06)

An earlier draft of this task added `tenant_id` to `DBConnection` as a routine, "HIGH confidence"
part of the model upgrade. That's wrong: `mapper_tasks/07_tenant_isolation_signoff.md` and
`schema_intel_tasks/09_tenant_isolation_signoff.md` both already recorded a standing, repo-wide
decision — *"no code change without a product decision on introducing tenant_id app-wide... do
not implement in this module in isolation."* `DBConnection` is the single most upstream, most
shared table in the schema (`Mapping`, `Pipeline`, `CatalogTable`, `SchemaSnapshot` all FK into
it), so adding `tenant_id` here first, without the same cross-reference treatment those two files
gave it, would either quietly break that rule or set an inconsistent precedent other epics didn't
get to follow. See the new `connector_tasks/10_tenant_isolation_signoff.md` for the full
cross-reference.

**This is a decision for you (repo owner), not something to auto-implement.** Two options once
you decide:
1. **Drop `tenant_id` from this task entirely** until the app-wide decision lands — matches how
   `mapper_tasks`/`schema_intel_tasks` treated their own modules; simplest, most consistent.
2. **Add it now as an inert, nullable placeholder**, mirroring `backend/app/models/pipeline.py`'s
   own `tenant_id` column and its comment (`# Nullable until app-wide tenant_id lands (mapper_tasks
   #7). When added, set nullable=False and add a WHERE filter to every query.`) — i.e. the column
   exists but nothing reads, writes, or filters on it yet, so it carries no functional risk while
   staying consistent with the one other place in the codebase that already added it this way.

Until you pick one, treat this single column as blocked; the rest of Task #1 (`health_status`,
soft-delete columns, `secrets_ref`, audit fields) has no dependency on it and can proceed
independently.

## Scope

Upgrade `DBConnection` with the columns needed by downstream FRs. This is an additive schema change — no existing data migration required (dev-only data, it's acceptable to drop/recreate if needed).

### Model changes — `backend/app/models/connection.py`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | Integer PK | Already exists |
| `name` | String, unique, indexed | Already exists |
| `type` | String | Already exists (e.g. `postgres`, `mysql`) |
| `config` | JSON | Already exists — **but see note below** |
| `secrets_ref` | String, nullable | Reference key to vault/secret manager (e.g. vault path or encrypted key name). Null if no secrets have been migrated yet. |
| `tenant_id` | String, nullable | **⚠️ Gated — see decision needed below before adding this column.** |
| `health_status` | String, default `"unknown"` | One of `unknown`, `healthy`, `degraded`, `down`. Updated by Task #5's health-check scheduler. |
| `last_tested_at` | DateTime, nullable | Timestamp of last test-connection or health check. |
| `last_test_error` | Text, nullable | Last error message from a failed test. Cleared on successful test. |
| `is_deleted` | Boolean, default `False` | Soft-delete flag. Queries should filter `is_deleted=False` by default. |
| `deleted_at` | DateTime, nullable | When soft-delete occurred. |
| `created_by` | String, nullable | Actor who created the connection (user email or system). |
| `updated_by` | String, nullable | Actor who last modified it. |
| `created_at` | DateTime | Already exists |
| `updated_at` | DateTime(timezone=True) | Add — `server_default=func.now(), onupdate=func.now()`, matching the timestamp convention already used in `mapping.py`/`pipeline.py`/`schema_catalog.py`/`drift_event.py` (DB-side, timezone-aware) rather than a Python-side `datetime.utcnow` callable. |

**Config note:** After Task #2 (secret manager) lands, passwords/tokens should be stripped from `config` before save and stored only in the vault. The `config` column will hold non-secret fields only (host, port, dbname, schema, etc.). The model should not enforce this — it's a service-layer contract enforced by Task #2's service code.

### Migration strategy

Because this is a dev-only codebase with no production data:

1. Update the model file.
2. Regenerate tables via `Base.metadata.drop_all` + `create_all` for the **whole dev database**,
   not just the `connections` table. `connections` is FK'd from `Mapping`, `Pipeline`,
   `CatalogTable`, `SchemaSnapshot`, and `DriftEvent` (all already built) — dropping only
   `connections` in isolation either violates FK constraints (Postgres) or silently orphans rows
   across those five other tables (SQLite, which doesn't enforce FKs by default).

If production data existed, an Alembic migration would be required — out of scope here.

### Service helper — `backend/app/services/connection_service.py` (new)

Mirroring the `mapping_service.py` pattern, extract connection CRUD into a service layer:

- `create_connection(db, payload, actor) -> DBConnection` — validates, creates, records audit.
- `get_connection(db, id) -> DBConnection` — respects soft-delete (returns 404 if `is_deleted`).
- `list_connections(db, include_deleted=False) -> List[DBConnection]` — default hides soft-deleted.
- `update_connection(db, id, payload, actor) -> DBConnection` — non-secret fields only (see Task #8 for credential rotation).
- `soft_delete_connection(db, id, actor) -> DBConnection` — sets `is_deleted=True`, `deleted_at=now`, `updated_by=actor` (see Task #7 for dependency checks).
- `update_health(db, id, status, error=None)` — called by Task #4 and Task #5.

Move the existing creation logic from `connectors.py` into `create_connection()`.

## Dependencies

- Existing `DBConnection` model (will be modified in-place).

## Edge cases

- **Soft-deleted name reuse:** A user creates connection "prod-db", soft-deletes it, then tries to create "prod-db" again. The unique constraint on `name` would conflict with the soft-deleted row. Solution: either make the unique constraint conditional (`WHERE is_deleted = FALSE` — requires partial unique index, supported by Postgres and SQLite) or append a timestamp to the soft-deleted name (e.g. "prod-db__deleted_20260706"). Default to the conditional unique index approach where the DB supports it; fall back to name-mangling for MySQL. In SQLAlchemy this is expressed via dialect-specific `Index()` kwargs, not a plain `UniqueConstraint` — e.g. `Index("uq_connection_name_active", "name", unique=True, postgresql_where=text("NOT is_deleted"), sqlite_where=text("NOT is_deleted"))`.
- **Backfilling `updated_at`:** Since this column is new, any existing row will have `NULL` on first read. The service layer should handle `updated_at is None` gracefully (treat as `created_at`).
- **Config secrets bleed-over:** After model migration, existing rows still have secrets in `config`. The migration itself shouldn't touch values — Task #2 handles vault migration. Until then, existing `config` may contain both secret and non-secret fields. The `GET /connectors/{id}` response must not expose secrets (see Task #2).

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v   # new test dir, see Task #9
```

- Confirm `Base.metadata.create_all` picks up all new columns.
- Confirm soft-deleted connections are excluded from `list_connections()` by default.
- Confirm that `get_connection()` for a soft-deleted row returns 404.

## Risk

Low-medium. This is an additive schema change with no downstream consumers to break — the Connectors module is self-contained. The main risk is the `name` unique-constraint collision with soft-deleted rows (handled above).