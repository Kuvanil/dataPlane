# Task #2 — Read-only validation + PII/role guardrails (ADB-T2)

**TRD reference:** FR4, FR6, Security NFR (§4–5).

**Current state:** No statement classifier exists. No mechanism to detect or block write/DDL statements. No PII column masking or role-scoped result filtering exists in the AskData execution path. The existing `record_audit` helper doesn't include guardrail enforcement context.

## Scope

Build the server-side guardrail layer that sits between SQL generation and execution: validate that the generated SQL is read-only, check role permissions for table/column access, and mask or exclude PII columns from results.

### Backend — `backend/app/services/askdata_guardrails.py` (new)

#### Statement classifier

```python
class StatementType(enum.Enum):
    SELECT = "select"
    INSERT = "insert"
    UPDATE = "update"
    DELETE = "delete"
    DDL = "ddl"  # CREATE, ALTER, DROP, TRUNCATE
    UNKNOWN = "unknown"

def classify_statement(sql: str) -> StatementType:
    """Classify a SQL statement by its type.
    
    Uses SQL parsing (sqlparse or similar) to reliably determine
    the statement type, not naive string matching.
    """
```

- Use `sqlparse` (already in requirements.txt or add it) to parse and classify.
- Reject any statement that is not a `SELECT`.
- Edge case: multiple statements in one input → reject with "Only single SELECT statements are supported."

#### Write/DDL blocking (FR4)

```python
def validate_read_only(statements: list[StatementType]) -> list[str]:
    """Return error messages for any non-SELECT statements found."""
```

- Called after generation, before execution.
- If any non-SELECT statement is detected, return a user-facing message: "AskData is read-only. Write/DDL operations are not supported."
- Log the blocked attempt and emit an audit event (see task #7).

#### PII column guardrail (FR6)

```python
def filter_pii_columns(
    catalog_metadata: dict,
    user_role: str,
    columns: list[str]
) -> list[str]:
    """Return columns that the user is permitted to see.
    
    Consult Schema Intel's classification metadata. Any column
    classified as PII/High Risk is excluded unless the user's
    role has an explicit PII-access permission.
    """
```

- Consult Schema Intel's column classification metadata (`classification: {level: "High"|"Medium"|"Low", label: "PII"|"Sensitive"|"Public"}`).
- Columns classified as High/PII are excluded from query results unless the user's role permits PII access.
- This is a server-side filter applied to the result set, not a WHERE clause injection.
- Exception: if the query explicitly selects a PII column and the user is not permitted, execution is blocked entirely with a clear message.

#### Role-scoped data filtering

- Integration with existing `SecurityService` or role/permission system.
- The guardrail should be aware of the user's role from the auth context.
- Result rows should be filtered according to row-level security policies if those exist.

### Integration with the execution pipeline

```
Generated SQL → classify_statement() → validate_read_only() → 
  filter_pii_columns() (rewrite SELECT list if needed) → 
  execute → post-process results for PII masking → return
```

### API Contract

No new public endpoints — these are internal services called by the AskData execution pipeline.

### Dependencies

- **Schema Intel** — column classification metadata (`classification` field on `CatalogColumn`). Must be available at query time.
- **Security/Auth** — user role/permission context from the request (JWT or session).
- **Task #1** — the generation pipeline must call these guards before execution.
- **Task #3** — execution layer must produce results that the guardrails can post-process.

## Edge cases

- **Mixed statements** — Reject the entire input if it contains both SELECT and non-SELECT statements.
- **Subqueries in FROM clause** — Should still be valid SELECT statements.
- **CTEs (WITH clauses)** — Valid only if the final statement is a SELECT.
- **No-op SELECT** — `SELECT 1` is allowed but the guardrails don't prevent it.
- **PII column explicitly in SELECT list + no permission** — Block execution, inform the user which columns are restricted.
- **SELECT *** — The guardrail must resolve `*` to the actual column list from the catalog, then filter PII columns. The execution layer must rewrite or post-process the result.
- **Role context missing** — Default to most restrictive (block PII columns, deny write).

## Verify

```bash
cd backend && .venv/bin/pytest tests/askdata/ -v -k "guardrail"
```

- Test `classify_statement` for each statement type (SELECT, INSERT, UPDATE, DELETE, DDL variations, multi-statement).
- Test `validate_read_only` rejects non-SELECT with proper error message.
- Test `filter_pii_columns` excludes High-risk columns for default role.
- Test `filter_pii_columns` permits PII columns for admin/privileged role.
- Test that `SELECT *` is properly resolved and PII-filtered.
- Test integration: generation → guardrails → (mock) execution → filtered results.

## Risk

Medium-High. PII filtering on `SELECT *` requires column resolution from the catalog, which adds latency and complexity. The guardrails must be performant since they're in the critical path of every NL-to-SQL execution. The role/PII guardrail design choices need Security team sign-off (task #9).