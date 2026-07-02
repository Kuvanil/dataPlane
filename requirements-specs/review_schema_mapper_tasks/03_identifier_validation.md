# Task #3 — Validate identifiers in `cast.to` and `lookup.*` (SQL-injection surface)

**Reviewer finding:** §11.3 (CRITICAL). The transformation grammar's
`_sql_cast` and `_sql_lookup` interpolate user-supplied strings
(`payload["to"]`, `payload["table"]`, `payload["key_column"]`,
`payload["value_column"]`) directly into SQL via f-strings. The grammar's
field-type checker only enforces "is a non-empty string" for these
fields — no identifier-shape or allow-list check.

Contradicts the published contract's explicit security claim
("No string interpolation of user data into SQL,"
`docs/mapper-mapping-contract.md` line 148) and the NFR
("transformation expressions sanitized/validated to prevent injection,"
TRD §5). Will become a live SQL injection vector the moment Pipelines
wires `compile_sql` output into execution.

## Changes

### 1. `backend/app/services/transformation_grammar.py`
- Add `_IDENT_RE = r"^[A-Za-z_][A-Za-z0-9_]*$"` regex (valid SQL identifier).
- Add `SQL_TYPES` set with the same type names the validation service
  recognizes (TEXT, VARCHAR, INTEGER, BIGINT, FLOAT, DOUBLE, DATE,
  TIMESTAMP, BOOLEAN, etc.) — `cast.to` must reference one of these.
- Add `_check_identifier()` helper.
- Extend the `_KIND_SCHEMAS` field-type tags with `"identifier"` and
  `"sql_type"`.
- Wire the new tags through `_check_field`'s dispatch.
- Update `cast` schema: `to` becomes `"sql_type"` (must be in SQL_TYPES).
- Update `lookup` schema: `table`, `key_column`, `value_column` become
  `"identifier"` (must match `_IDENT_RE`).

### 2. `backend/tests/mapping/test_transformation_grammar.py`
- Add tests asserting that `parse()` (and therefore `compile_sql`)
  rejects:
  - `cast.to = "TEXT); DROP TABLE users; --"`
  - `cast.to = "users.id"` (dotted — not a type name)
  - `lookup.table = "users; DELETE FROM users; --"`
  - `lookup.key_column = "id'; DROP TABLE"`
  - `lookup.value_column = "1 OR 1=1"`
  - `lookup.key_column = "123starts_with_digit"` (starts with digit — invalid identifier)
- Confirm that valid inputs (alphanumeric + underscore, starting with letter
  or underscore) still parse.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 74+/74+.

## Risk

- `cast.to` was previously accepted as any non-empty string. This change
  restricts it to the SQL_TYPES set. Any existing mappings using a
  type name outside that set (e.g. `NUMERIC(10,2)`, `BYTEA`) will start
  failing at parse time. Acceptable trade-off — these were never safe to
  inject anyway. The set covers every type the validation service
  recognizes.
- The `lookup.*` change rejects identifiers with spaces or special
  characters. Real-world tables/columns always match `^[A-Za-z_][A-Za-z0-9_]*$`
  in every supported backend (SQLite, Postgres, MySQL, Oracle).
