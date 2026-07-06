# Task #1 — Catalog data model + persisted discovery engine (SI-T1, SI-T4 store half)

**TRD reference:** FR1, AC1, §11 Data model (`SchemaObject`), §12 DoD "Structure discovered and persisted."

**Current state:** Discovery exists but nothing is persisted. `SchemaService.get_full_schema()`
(`backend/app/services/schema_service.py:50-64`) calls `connector.get_tables()` +
`connector.get_table_schema()` per table and returns a plain `{table: [columns]}` dict — recomputed
on every call to `GET /api/v1/connectors/{id}/schema` (`backend/app/api/routers/connectors.py:89-98`).
There is no `SchemaObject`/table/column ORM model anywhere in `backend/app/models/` — only
`schema_snapshot.py` exists, and that stores one opaque JSON blob per connection per scan, not
normalized rows a catalog or search endpoint could query. `BaseConnector`
(`backend/app/connectors/base.py:20-31`) only returns `name/type/nullable/primary_key` per column —
no foreign keys, no table-level metadata (row count, comment). Two connectors have a **known bug**:
Postgres (`backend/app/connectors/postgres.py:61`) and Oracle's JDBC-style branch
(`backend/app/connectors/oracle.py:111`) hardcode `"primary_key": False` instead of querying
constraints — MySQL, SQLite, and JDBC connectors already do this correctly (`mysql.py:63`,
`sqlite.py:46`, `jdbc.py:64`), so there's a working reference pattern per connector type.

## Scope

### Models — `backend/app/models/schema_catalog.py`

- `CatalogTable` — `id`, `connection_id` (FK → `DBConnection`), `table_name`, `row_count_estimate`
  (nullable, populated by #2's profiling if available, not required here), `created_at`,
  `updated_at`, `last_scanned_at`.
- `CatalogColumn` — `id`, `table_id` (FK → `CatalogTable`), `column_name`, `data_type`, `nullable`,
  `is_primary_key`, `ordinal_position`, `created_at`, `updated_at`. One row per column, replacing
  the ad-hoc dicts `get_full_schema()` returns today.
- `CatalogForeignKey` — `id`, `column_id` (FK → `CatalogColumn`), `references_table`,
  `references_column` — new concept, not present in `BaseConnector` today (see below).

Mirrors the pattern already established for Schema Mapper (`backend/app/models/mapping.py`) and
the in-progress Pipelines models (`backend/app/models/pipeline.py`).

### Connector contract — `backend/app/connectors/base.py`

Extend `get_table_schema()`'s documented return shape to add an optional `foreign_keys` list per
column (`[{"references_table": ..., "references_column": ...}]`, empty list if none) so FK
discovery has somewhere to attach in each connector implementation. Extending the shape rather
than adding a new abstract method keeps existing connectors compiling: default to `[]` in a
connector that hasn't been updated yet, and treat "no FKs discovered" as generally acceptable per
connector (unlike the PK bug below, which is a false negative on an already-required field).

### Bug fixes — `backend/app/connectors/postgres.py`, `backend/app/connectors/oracle.py`

Replace the hardcoded `"primary_key": False` with a real constraint lookup, following the pattern
already correct in `mysql.py`/`sqlite.py`/`jdbc.py` (query `information_schema.key_column_usage` /
`pg_constraint` for Postgres; `ALL_CONS_COLUMNS`/`ALL_CONSTRAINTS` for Oracle's non-JDBC branch —
the JDBC branch at `oracle.py:111` can reuse whatever `jdbc.py:64` already does). This is a
correctness bug independent of the rest of this task and should land even if the catalog
persistence work is deferred.

### Service — `backend/app/services/schema_catalog_service.py`

- `scan_connection(db, connection_id, actor) -> ScanResult` — calls the connector, upserts
  `CatalogTable`/`CatalogColumn`/`CatalogForeignKey` rows (replace-on-rescan semantics: delete rows
  for tables no longer present, upsert the rest — simplest correct approach; don't try to diff
  in-place, that's task #6's job on the drift side, not this task's).
- `get_catalog(db, connection_id) -> List[CatalogTable]` — read path for #4's search endpoint.
- Keep `SchemaService.get_full_schema()` as-is for now — `diff.py`'s live compare and
  `security.py`'s live classify (routers) both depend on its exact dict shape, and migrating those
  call sites is out of scope for this task (would be a drive-by refactor). New code (catalog scan,
  #2, #3, #6) should read from the new persisted model instead of calling
  `get_full_schema()` directly, so those call sites migrate naturally as they're built, not as a
  separate mass-refactor.

### Router — `backend/app/api/routers/schema_catalog.py` (new)

`POST /api/v1/catalog/scan/{connection_id}` — triggers `scan_connection()` synchronously for now
(making it async is optional here since it's mechanical persistence, not profiling — #2's actual
profiling queries are the slow part; revisit if scan latency on wide schemas becomes a problem).
`GET /api/v1/catalog/{connection_id}/tables` — list persisted tables/columns for a connection
(the mechanical half of #4's search; #4 adds the actual filter params on top of this).

## Dependencies

- `DBConnection` model (already exists).
- None on other Schema Intel tasks — this is the foundation.

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/ -v   # new test dir, see Task #10
```
- Confirm `Base.metadata.create_all` picks up `catalog_tables`/`catalog_columns`/`catalog_foreign_keys`.
- Manually verify the Postgres/Oracle PK fix against a real seeded connection (`backend/seeds/`) —
  a regression here silently breaks anything downstream that trusts `is_primary_key`.

## Risk

Low-medium. Additive schema work with no existing catalog to migrate away from. The PK bug fix
touches connector code used by the already-shipped Schema Mapper and Schema Drift features — a
regression there would be a real production bug, not just an incomplete new feature, so it needs
its own test coverage independent of the rest of this task.
