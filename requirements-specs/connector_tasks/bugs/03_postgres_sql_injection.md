# Bug 03: Table name interpolated via f-string in `get_table_schema` — SQL injection

- **Severity:** Low (in practice), High (in principle)
- **File:** `backend/app/connectors/postgres.py` lines 58-62
- **Status:** Fixed (2026-07-09)

## Description

`PostgresConnector.get_table_schema()` interpolates the `table_name` parameter directly into SQL queries using an f-string instead of a parameterized query. While the table name comes from `get_tables()` (which only returns real table names from `information_schema`), this is still a SQL injection vulnerability in principle.

## The Problematic Code

```python
def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
    conn = self.connect()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute(f"""
        SELECT column_name as name, data_type as type, is_nullable = 'YES' as nullable
        FROM information_schema.columns
        WHERE table_name = '{table_name}'          # <--- f-string interpolation
    """)
```

Note that the PK and FK queries on lines 66-98 *do* use parameterized queries (`WHERE tc.table_name = %s`), making this inconsistency even more suspicious — the same function mixes safe and unsafe patterns.

## Impact

- **Low in practice** because `get_table_schema` is only called with table names returned by `get_tables()`, which only returns real table names from the database. No user-supplied input reaches this function directly.
- **High in principle** because if a future code path ever passes user input to `get_table_schema`, this becomes a critical vulnerability. The inconsistent pattern (f-string for columns query, parameterized for PK/FK queries) is a maintenance trap.

## Suggested Fix

Replace the f-string with a parameterized query, matching the pattern used in the PK and FK queries below:

```python
cursor.execute("""
    SELECT column_name as name, data_type as type, is_nullable = 'YES' as nullable
    FROM information_schema.columns
    WHERE table_name = %s
""", (table_name,))
```

## Detection

A `grep` for f-string SQL patterns in connector code:
```bash
grep -rn 'f""".*WHERE' backend/app/connectors/
```

## Resolution

**Fixed 2026-07-09.** Swept all 5 connectors for the same pattern, not just Postgres — the
`grep` in this file's own Detection section was never actually run before filing:

- `postgres.py` — f-string → `%s` parameterized query, matching the PK/FK queries in the same
  function (the inconsistency this bug called out).
- `mysql.py` — same f-string-for-columns-query pattern (`get_table_schema`); the WHERE clause
  already used `%s` further down, only the `SELECT`'s leading f-string was pointless (no
  interpolated value inside it) — dropped the `f` prefix.
- `sqlite.py`, `oracle.py` (`_sim_mode` branch) — `PRAGMA table_info({table_name})` /
  `PRAGMA foreign_key_list({table_name})`. PRAGMA statements cannot take bound parameters in
  sqlite3, so the fix quotes the identifier (`"` doubled per SQL-standard escaping) rather than
  parameterizing — same risk class, different mechanism since `%s` isn't an option here.

No test added: exploiting this requires a table name only `get_tables()` can supply (real
schema-introspected names), so there's no reachable malicious-input path to assert against
without faking a hostile schema. Fixed as defense-in-depth per the bug's own "High in principle"
framing — a future caller that ever threads user input into `get_table_schema` inherits a safe
function instead of a trap.