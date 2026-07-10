# Task #1 — Query execution service + pagination (QS-T1)

**TRD reference:** FR3, §11 API: `POST /query/execute`.

**Current state:** `backend/app/api/routers/query.py` has `POST /query/nl2sql` which executes SQL via `NL2SQLService.execute_safe_query()`, but this is NL-to-SQL path, not a general SQL execution endpoint. There is no dedicated direct-execution endpoint, no pagination, no streaming, no timeout configuration.

## Scope

Build the core query execution service that takes raw SQL and a connection context, executes it through the connector framework, and returns paginated results with metadata.

### Backend — `POST /query/execute`

```json
Request: {
  "connection_id": int,
  "sql": string,
  "page": int (default 1),
  "page_size": int (default 100, max 1000),
  "timeout_seconds": int (default 30)
}

Response: {
  "query_id": int,
  "columns": [{"name": string, "type": string}],
  "rows": [[...]],
  "total_rows": int,
  "page": int,
  "page_size": int,
  "has_more": bool,
  "execution_time_ms": int,
  "truncated": bool
}
```

### Execution service — `backend/app/services/query_execution_service.py` (new)

```python
class QueryExecutionService:
    @classmethod
    def execute_query(cls, connection_id: int, sql: str, page: int, page_size: int, 
                      timeout_seconds: int, db: Session, user: User) -> QueryResult:
        """Execute SQL and return paginated results."""
    
    @classmethod
    def get_result_page(cls, query_id: int, page: int, page_size: int, db: Session) -> QueryResultPage:
        """Retrieve a previously executed query's result page (for pagination)."""
    
    @classmethod
    def cancel_query(cls, query_id: int, db: Session) -> None:
        """Cancel a running query."""
```

Key behaviors:
- Use the connector framework (`get_connector(connection)`) for execution.
- Stream results: fetch `page_size` rows, return them, cache the cursor for subsequent page requests (if using server-side cursors).
- Enforce timeout via `ThreadPoolExecutor` or connector-level timeout.
- Return column metadata (name, type) from the cursor description.
- Persist execution to `QueryHistory`.
- Respect row caps (configurable max rows before truncation).

### Data model — extend `QueryHistory`

The existing `QueryHistory` model needs to support direct SQL execution (not just NL-to-SQL). Add/verify:
- `connection_id` (FK to connections)
- `sql` (the executed SQL text)
- `result_columns` (JSON, column metadata)
- `result_row_count` (total rows before pagination)
- `execution_time_ms`
- `status` (running, completed, failed, cancelled)
- `error_message`
- `page_count` (total pages available)
- `executed_by` (user identity)

### Connection context

The user must select a connection before executing. The endpoint validates:
- Connection exists and is not deleted.
- Connection is healthy (or at least reachable).
- User has access to this connection (role/permission check).

### Dependencies

- **Connectors** — the connector abstraction for execution.
- **Task #2** — statement classifier to be integrated.
- **Task #3** — write gating to be integrated.

## Edge cases

- **Connection unavailable** — Return 503 with clear error message.
- **Query timeout** — Return partial results with `timeout: true` if available, or error if no results yet.
- **Syntax error in SQL** — Return the database error message.
- **Zero results** — Success with empty `rows` array and `total_rows: 0`.
- **Extremely long SQL** — Accept up to a configurable limit (e.g., 1MB).
- **Concurrent execution limits** — Per-user concurrency limits (e.g., max 3 concurrent queries).
- **Cancellation** — Allow user to cancel a running query.

## Verify

```bash
cd backend && .venv/bin/pytest tests/query_studio/ -v -k "execution"
```

- Test execute SELECT returns paginated results.
- Test pagination: page 1 → page 2 returns different rows.
- Test timeout enforcement.
- Test error handling (syntax error, connection error).
- Test column metadata in response.
- Test query history is persisted after execution.

## Risk

Medium. The connector framework's `get_connector` returns a raw DB-API connection. Pagination requires either server-side cursors (DB-specific) or LIMIT/OFFSET wrapping (universal but inefficient for large offsets). Use LIMIT/OFFSET as default with fallback strategies documented.