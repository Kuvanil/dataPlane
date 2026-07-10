# Task #7 — Audit emission (ADB-T7)

**TRD reference:** FR9 (§4).

**Current state:** No audit events are emitted for AskData operations. The existing `record_audit` helper (`backend/app/services/audit_helper.py`) is used by connectors but not by AskData or Query Studio.

## Scope

Emit audit events at each stage of the AskData pipeline: NL question received, SQL generated (with the generated SQL text), execution outcome (with row count or error), and guardrail enforcement (write-blocked, PII-filtered).

### Audit events

| Event Type | Trigger | Payload |
|---|---|---|
| `askdata.question_received` | User submits NL question | `{session_id, connection_id, message_text, message_length}` |
| `askdata.sql_generated` | SQL generation completes | `{session_id, connection_id, generated_sql, confidence, tables_used, generation_time_ms}` |
| `askdata.guardrail_blocked` | Guardrail rejects a request | `{session_id, reason: "write_detected"\|"pii_access_denied", sql, details}` |
| `askdata.execution_completed` | SQL execution completes | `{session_id, connection_id, sql, row_count, execution_time_ms, truncated, success}` |
| `askdata.execution_failed` | SQL execution fails | `{session_id, connection_id, sql, error_message, execution_time_ms}` |
| `askdata.handoff_initiated` | User sends to QS or Visualize | `{session_id, target: "query_studio"\|"visualize", message_id, entity_id}` |

### Integration

- Call `record_audit(db, event_type, ...)` at each pipeline stage in the askdata service.
- Include a `correlation_id` across all events in a single NL question → answer flow so the full lifecycle can be traced in the Audit Trail viewer.

### Dependencies

- **Audit Trail (AUDIT-T1)** — The canonical event schema and ingestion API must be available.
- **`record_audit` helper** — Already exists, may need extension for the AskData-specific event types.

## Verify

- Test each event type is emitted at the correct pipeline stage.
- Test correlation_id traces full lifecycle.
- Test guardrail-blocked event includes reason and details.
- Test audit events include actor identity from auth context.

## Risk

Low. Standard audit emission following the established pattern. The main effort is instrumenting each pipeline stage.