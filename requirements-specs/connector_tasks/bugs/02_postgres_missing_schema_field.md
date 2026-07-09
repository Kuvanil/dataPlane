# Bug 02: PostgreSQL missing `schema` and `sslmode` fields that task spec #3 documents

- **Severity:** Medium
- **File:** `backend/app/services/connector_catalog.py` lines 30-44 vs `requirements-specs/connector_tasks/03_connector_catalog_types.md`
- **Status:** Open

## Description

Task spec #3 defines the PostgreSQL connector type with fields `host`, `port`, `dbname`, `user`, `password`, `schema` (optional, default="public"), and `sslmode` (select with 6 options). The actual implementation in `connector_catalog.py` only has `host`, `port`, `dbname`, `user`, `password` — `schema` and `sslmode` are missing.

## Spec says (task #3):
```python
"postgres": ConnectorTypeMetadata(
    fields=[
        FieldDef(key="host", ...),
        FieldDef(key="port", ...),
        FieldDef(key="dbname", ...),
        FieldDef(key="user", ...),
        FieldDef(key="password", ...),
        FieldDef(key="schema", label="Schema", type="text", required=False, default="public"),  # MISSING
        FieldDef(key="sslmode", label="SSL Mode", type="select", required=False,               # MISSING
                 options=["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
                 default="prefer"),
    ],
    secret_fields=["password"],
)
```

## Code has (connector_catalog.py lines 30-44):
```python
"postgres": ConnectorTypeMetadata(
    fields=[
        FieldDef(key="host", ...),
        FieldDef(key="port", ...),
        FieldDef(key="dbname", ...),
        FieldDef(key="user", ...),
        FieldDef(key="password", ...),
        # No schema field
        # No sslmode field
    ],
    secret_fields=["password"],
)
```

## Impact

- **Frontend forms:** Users cannot configure a non-default schema or SSL mode when creating a Postgres connection.
- **PostgresConnector hardcodes schema:** The `get_tables()` and `get_table_schema()` methods in `postgres.py` hardcode `table_schema = 'public'` — there is no way to connect to a Postgres database where tables live in a different schema.
- **No SSL configuration:** Users connecting to Postgres over the internet (e.g., RDS, Cloud SQL) cannot configure SSL mode, which may be required by their security policy.

## Suggested Fix

Add `schema` and `sslmode` fields to the Postgres entry in `connector_catalog.py`, and update `PostgresConnector.__init__` to accept and use them:

```python
FieldDef(key="schema", label="Schema", type="text", required=False, default="public"),
FieldDef(key="sslmode", label="SSL Mode", type="select", required=False,
         options=["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
         default="prefer"),
```

Then update `PostgresConnector.__init__` to accept `schema` and `sslmode` parameters, and update `get_tables()`/`get_table_schema()` to use the configured schema instead of hardcoded `'public'`.