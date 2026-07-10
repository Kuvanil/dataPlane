# Task #3 — Safe execution + result summarization (ADB-T3)

**TRD reference:** FR5, Performance NFR (§4–5).

**Current state:** The existing `query.py` router has `POST /query/nl2sql` which calls `NL2SQLService.execute_safe_query()` for execution. The `askdata.py` router's `/nl2sql` enqueues a Celery task but doesn't return results directly. There is no NL summary generation from query results. No result table with pagination exists for AskData responses.

## Scope

Build the safe execution layer that takes grounded SQL, executes it against the selected connection, returns a natural-language summary of the results alongside a paginated result table, and handles timeouts, large results, and errors gracefully.

### Backend — execution orchestration

1. **Execute grounded SQL** — Execute the validated SQL from task #1 (after guardrail check from task #2) against the selected connection using the connector framework (`get_connector(connection)` pattern from `backend/app/services/schema_service.py`).
   - Use Query Studio's execution service (QS-T1) for consistent execution path.
   - Enforce a timeout (configurable, default 30s) on all queries.
   - Respect row caps to prevent UI overload (configurable, default 1000 rows).

2. **NL summarization** — After execution, generate a natural-language summary of the results using the LLM. The prompt should include:
   - The user's original question.
   - The generated SQL.
   - The result set summary (row count, column names, aggregate values if any).
   - Instruction: "Summarize what this data shows in 2-3 sentences, relating it back to the user's question."
   - Do NOT pass individual row data to the LLM — only column names, row count, and aggregate context.

3. **Result structure** — Return a structured response:
   ```json
   {
     "summary": "There are 1,247 active customers as of last month, representing 68% of the total customer base.",
     "sql": "SELECT COUNT(*) FROM customers WHERE status = 'active' AND created_at >= date('now', '-1 month')",
     "columns": ["count"],
     "rows": [[1247]],
     "total_rows": 1,
     "execution_time_ms": 45,
     "truncated": false
   }
   ```

### API endpoint — `POST /askdata/message`

This is the primary AskData endpoint that chains the full pipeline:
```
message + connection_id + session_id
  → Task #5: retrieve conversation context
  → Task #1: generate grounded SQL
  → Task #2: validate guardrails
  → execute SQL → collect results
  → generate NL summary
  → Task #5: persist to conversation context
  → return structured response
```

### Dependencies

- **Task #1** (generation) and **Task #2** (guardrails) — both must be complete.
- **Query Studio (QS-T1)** — execution service for consistent query execution.
- **LLM service** — for summarization (can reuse Ollama from existing `AskDataService`).
- **Task #5** — conversation context for session management.

## Edge cases

- **No results returned** — Summary: "Your query returned no results. This means there are no records matching the criteria."
- **Query timeout** — Return partial results if available, with `timeout: true` flag. Summary explains the timeout.
- **Query error** — Return the error message, do NOT attempt summarization. Suggest rephrasing the question.
- **Large result set** — Respect row cap. Return `truncated: true` and indicate the total count if available (via `SELECT COUNT(*)` wrapper).
- **LLM summarization failure** — Fall back to a template-based summary: "Query returned {n} rows with {m} columns."
- **Connection unavailable** — Return clear error: "The database connection appears to be unavailable. Check connection health."

## Verify

```bash
cd backend && .venv/bin/pytest tests/askdata/ -v -k "execution"
```

- Test full pipeline: message → SQL → guardrails → execute → summary.
- Test timeout enforcement.
- Test row cap enforcement with truncated flag.
- Test fallback summary when LLM fails.
- Test error handling for failed queries.

## Risk

Medium. Execution depends on the connector framework being robust. Large result sets could stress memory. Timeout handling must be reliable to prevent long-running queries from blocking the execution pipeline.