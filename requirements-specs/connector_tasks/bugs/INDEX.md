# Connectors — Validation Report

> Validated against `TRD_DataPlane_Connectors.md` (FR1–FR9), 10 task spec files, and implementation code as of commit `d2ea82b`.
> Status: 69/69 tests passing. 6 of 9 FRs done; FR3/FR9 partial; FR6 not done.

## Bug Summary

| # | File | Severity | Title |
|---|------|----------|-------|
| [01](01_jdbc_catalog_mismatch.md) | Task #3 / `connector_catalog.py` | **Medium** | JDBC field definitions in task spec #3 don't match implementation |
| [02](02_postgres_missing_schema_field.md) | Task #3 / `connector_catalog.py` | **Medium** | PostgreSQL missing `schema` and `sslmode` fields that task spec #3 documents |
| [03](03_postgres_sql_injection.md) | `postgres.py:58-62` | Low | **Fixed 2026-07-09** — Table name interpolated via f-string in `get_table_schema` — SQL injection (swept + fixed in all 4 affected connectors, not just Postgres) |
| [04](04_no_connection_update_endpoint.md) | Router / Task #8 | **High** | `PUT /connectors/{id}` and credential rotation (#8) completely missing from code (correctly !blocked) |
| [05](05_secret_manager_not_implemented.md) | Task #2 | **High** | Secret manager (#2) not implemented — credentials stored in plaintext at rest (correctly !blocked) |
| [06](06_test_structure_incomplete.md) | Task #9 / test files | Low | Only 6 of 14 planned test modules exist — soft_delete, audit, credential_rotation, model, implementation tests missing |
| [07](07_discovery_on_create_not_invoked.md) | `connectors.py` / `main.py` | Low | No automatic schema discovery trigger on connection creation — discovery is manual-only |

## FR Coverage Verification

| FR | Requirement | Status | Task(s) |
|----|------------|--------|---------|
| FR1 | List connector types with metadata | ✅ Done | #3 |
| FR2 | Create connection by type + parameters | ✅ Done | #1, #3 |
| FR3 | Credentials in secret manager, never returned | ⚠️ Partial — never returned ✅, vault storage [!] | #2 |
| FR4 | Test Connection with diagnostics + timeout | ✅ Done | #4 |
| FR5 | Live health status per connection | ✅ Done | #5 |
| FR6 | Edit non-secret fields + rotate credentials | ❌ Not done (blocked on #2) | #8 |
| FR7 | Soft-delete with dependency flagging | ✅ Done | #7 |
| FR8 | Trigger schema discovery on demand | ⚠️ Partial — on-demand ✅, auto-on-create ❌ | #6 |
| FR9 | Audit events for CRUD | ⚠️ Partial — create/delete/test/discover ✅, edit/rotate ❌ | #7, #8 |

## Inaccuracies vs Task Specs

| # | Task Spec | Spec Says | Code Does | Impact |
|---|-----------|-----------|-----------|--------|
| 01 | #3 JDBC | `url`, `driver_class`, `user`, `password`, `connection_properties` | `url` (secret), `schema` only | Frontend forms won't show expected fields |
| 02 | #3 PostgreSQL | Has `schema` (default="public") + `sslmode` select | No `schema` field, no `sslmode` | Schema is hardcoded to 'public' in queries |
| 03 | #9 Tests | 14 test modules, ~75 tests | 6 modules, 69 tests | Coverage gaps |

## New Tasks Needed

| # | Title | Reason |
|---|-------|--------|
| N01 | Automatic schema discovery on connection creation | FR8 says "on demand" but auto-trigger on create would prevent drift window |
| N02 | Frontend connector management task | CONN-T5 never got a proper frontend task file — only "minimal alignment" mentioned |
| N03 | PostgreSQL schema scoping task | PostgresConnector hardcodes `schema='public'` — needs per-connection schema selection |