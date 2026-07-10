# Task #8 — Audit emission (QS-T8)

**TRD reference:** FR9 (§4).

**Current state:** No audit events are emitted for Query Studio operations. The `record_audit` helper exists but isn't called from the query execution path.

## Scope

Emit audit events for every executed statement in Query Studio: query execution (text, actor, context, row count, status).

### Audit events

| Event Type | Trigger | Payload |
|---|---|---|
| `query.execution_started` | User submits SQL for execution | `{query_id, connection_id, sql_preview, statement_type, actor}` |
| `query.execution_completed` | SQL execution succeeds | `{query_id, connection_id, sql, row_count, execution_time_ms, statement_type, actor}` |
| `query.execution_failed` | SQL execution fails | `{query_id, connection_id, sql, error_message, execution_time_ms, statement_type}` |
| `query.write_confirmed` | User confirms write statement | `{query_id, connection_id, sql, statement_type, confirmation_token, actor}` |
| `query.exported` | User exports results as CSV | `{query_id, connection_id, row_count, format: "csv", actor}` |

### Integration

- Call `record_audit(db, "query.execution_completed", ...)` at each QS-T1 execution completion.
- Include `statement_type` from QS-T2 classifier.
- Include `confirmation_token` for write-gated queries (QS-T3).

### Dependencies

- **Audit Trail (AUDIT-T1)** — canonical event schema.
- **QS-T1, QS-T2, QS-T3** — pipeline stages that trigger events.

## Risk

Low.