# Task #8 — Audit events for every vault operation

**Reference:** TRD §5 FR7, §6 NFR Auditability. Depends on #4 (`ConnectionService` wiring — the
call sites that need to emit these events).

**Goal:** Every `store`/`retrieve`/`rotate`/`delete` call is traceable in dataPlane's existing
Audit Trail, following the same `record_audit`/`emit_audit_event` pattern already used throughout
`connectors.py`, `connector_tasks#7`'s soft-delete flow, and every other epic in this codebase —
not a new audit mechanism.

## Changes

### `backend/app/services/connection_service.py` (and/or `secret_manager.py` call sites)

- On `store()` (connection create/update with new secrets): audit event
  `secret_store`, payload `{connection_id, actor, field_names}` — **never** the secret values
  themselves, only which fields were stored.
- On `retrieve()`: audit event `secret_retrieve`, but **batched at info-level, not per-column-
  access** — per `connector_tasks#2`'s existing note that `retrieve()` is called during every
  pipeline execution and per-call audit rows would spam the trail. One audit event per logical
  operation (e.g. one per pipeline run, one per connector "Test Connection" click), not one per
  field fetched within it.
- On `rotate()` (Task #6): audit event `secret_rotate`, payload `{connection_id, actor,
  rotated_at}`.
- On `delete()` (hard delete): audit event `secret_delete`, payload `{connection_id, actor}`.
- All four event types must be distinguishable in the existing Audit Trail UI's module/event-type
  filters (`usecase.md`'s "Filter by module" / "Filter by outcome" behavior) — reuse the existing
  event-type taxonomy, add these as new recognized values rather than a parallel logging system.

## Tests

- `backend/tests/secrets/test_secret_audit_events.py`:
  - Each of `store`/`retrieve`/`rotate`/`delete` produces exactly the expected audit event type.
  - No audit payload contains a secret value — assert against the serialized payload, not just the
    Python dict, to catch accidental `str()`-ing of a secret object.
  - `retrieve()` during a single pipeline run produces one audit event, not one per field.

## Verify

```bash
cd backend && pytest tests/secrets/test_secret_audit_events.py -v
```

## Risk

- Low — follows an established, well-tested pattern already used across this codebase (audit
  events on create/delete/test/restore for connectors, per `connector_tasks/INDEX.md`'s FR9 row).
  The only new risk is retrieve-call log volume, explicitly addressed by batching per operation.
