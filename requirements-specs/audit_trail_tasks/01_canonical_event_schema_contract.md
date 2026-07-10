# Task #1 — Canonical event schema + SDK/contract (AUDIT-T1)

**TRD reference:** FR1, FR8, §11 Data model.

**Current state:** `AuditLog` model has `id`, `event_type`, `actor`, `connection_id`, `connection_name`, `payload` (unstructured JSON), `status`, `duration_ms`, `created_at`. No canonical schema, no correlation_id, no module/target/before_after fields.

## Scope

Define the canonical `AuditEvent` schema that all modules must conform to, create a shared SDK/contract for emitting events, and update the data model.

### Canonical schema — `backend/app/schemas/audit.py` (new or extend)

```python
class AuditEvent(BaseModel):
    # Core identity
    event_type: str                    # "connector.created", "query.executed", "askdata.question_received"
    actor: str                         # User identity who performed the action
    module: str                        # Source module: "connectors", "query_studio", "askdata", "pipelines", etc.
    
    # Target
    target_type: str                   # "connection", "query", "pipeline", "mapping", etc.
    target_id: str | int | None        # ID of the target entity
    target_name: str | None            # Human-readable name of the target
    
    # Before/After (for state-changing operations)
    before: dict | None                # Summary of state before the change
    after: dict | None                 # Summary of state after the change
    
    # Correlation
    correlation_id: str | None         # UUID linking events across modules in a single operation flow
    
    # Outcome
    outcome: str = "success"           # "success", "failure", "warning"
    summary: str | None                # Human-readable summary of what happened
    
    # Timing
    timestamp: datetime                # When the event occurred
    duration_ms: int | None            # How long the operation took
    
    # Metadata
    metadata: dict = {}                # Additional structured data (e.g., SQL text, row count, error message)
```

### Data model — extend `AuditLog`

Add columns to match the canonical schema:
- `module` (String, indexed)
- `target_type` (String)
- `target_id` (String, nullable)
- `target_name` (String, nullable)
- `correlation_id` (String, indexed, nullable)
- `before_summary` (JSON, nullable)
- `after_summary` (JSON, nullable)
- `summary` (Text, nullable)

### SDK/contract — `backend/app/services/audit_helper.py` (extend)

Update `record_audit` to accept the canonical schema fields. Create a module-level helper:

```python
def emit_audit_event(
    db: Session,
    event_type: str,
    actor: str,
    module: str,
    target_type: str,
    target_id: Any = None,
    target_name: str = None,
    before: dict = None,
    after: dict = None,
    correlation_id: str = None,
    outcome: str = "success",
    summary: str = None,
    duration_ms: int = None,
    metadata: dict = None,
) -> str:
    """Emit a canonical audit event. Returns the correlation_id."""
```

### Migration

- Additive schema change to `audit_log` table (new columns are nullable).
- Backfill: existing events get `module = "legacy"`, no correlation_id.

### Dependencies

- All modules that emit audit events must adopt the new schema.

## Verify

- Test that `emit_audit_event` creates an `AuditLog` row with all canonical fields.
- Test that correlation_id is returned and can be used for tracing.
- Test backward compatibility: existing `record_audit` calls still work.

## Risk

Low. Schema definition is straightforward. The main effort is coordinating adoption across all modules.