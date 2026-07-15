# Task #7 — Gated DDL execution via Query Studio's existing write path + new registry action

**Reference:** TRD §5 FR5, §11 Risks (autonomous-execution creep), §12 Technical Notes; INDEX.md
design decisions #1 (non-negotiable: no autonomous execution) and #2 (no parallel executor).
Depends on #6 (an approve action must exist to trigger this).

**Goal:** On plan approval, execute the plan's `generated_ddl` through the **existing** Query
Studio write-execution path — the same `query_execution_service.py` that already gates
INSERT/UPDATE/DELETE/DDL behind role + `confirm=true` (`statement_classifier.py:26,31`,
`query_execution_service.py:38-87`) — not a new executor.

## Changes

### 1. `backend/app/services/autopilot_registry.py`
- Register a new action: `schema_design_create`, with **`auto_capable=False`, `risk="high"`,
  `reversible=False`** — hardcoded, matching the existing `migration_execute` precedent exactly.
  This must pass the same import-time assertion this file already enforces for other actions
  (`auto_capable` implies `reversible + low risk` — this action must NOT claim `auto_capable=True`,
  and the assertion should make that structurally impossible to get wrong later, not just a
  documented convention).
- Add `schema_design_create` alongside `ddl_execute`/`mapping_publish` in
  `PROHIBITED_ACTION_TYPES` if that set is specifically about "never auto-executable regardless of
  policy" (confirm its exact semantics vs. `auto_capable=False` before deciding whether both are
  needed — don't duplicate a guarantee that already exists structurally).

### 2. New: `agentic_dba_execution_service.py` (thin — mostly wiring, not new execution logic)
- On approve (task #6's endpoint calls into this): for each proposed table in the plan, call
  `query_execution_service`'s existing write-execution function directly (same code path Query
  Studio's UI hits with `confirm=true`) — one call per object, not one call for the whole
  multi-statement DDL blob, so per-object success/failure can be tracked (task #9).
- Require the approving user to have the same role Query Studio's own write gate requires
  (admin) — do not introduce a weaker or different permission check for this path.
- Emit an audit event per executed object (`agentic_dba.schema_object_created` /
  `agentic_dba.schema_object_failed`, `module=agentic_dba`) in addition to whatever
  `query_execution_service` already emits for the underlying write.

### 3. Dialect awareness (decision #8)
- `generated_ddl` (from task #3) must already be dialect-appropriate for the plan's
  `source_connection_id`'s connector type — confirm task #3 threads dialect through, or add it
  here if not. Reuse the same dialect notion `SqlEditor.tsx`'s `DIALECTS` map already encodes on
  the frontend (Postgres/MySQL/SQLite/Oracle) — don't invent a second dialect taxonomy.

### 4. Tests
- `backend/tests/agentic_dba/test_execution_service.py` — confirm execution genuinely goes through
  `query_execution_service` (spy/assert the same function Query Studio's tests already exercise is
  called, not a duplicate path), confirm non-admin approval is rejected, confirm audit events land.

## Verify

```bash
cd backend && pytest tests/agentic_dba/test_execution_service.py -v
```
Manually: approve a real plan against a seeded connection, confirm the tables actually get created
(re-query after, per the existing Query Studio test convention of verifying real persistence, not
just a 200 response) and that the Audit Trail shows both the new `agentic_dba.*` events and Query
Studio's own existing write-execution events.

## Risk

- The single biggest risk in this task is architectural drift toward "just write a new executor,
  it's simpler" — resist this. If reusing `query_execution_service` genuinely doesn't fit (e.g. it
  can't run multi-statement DDL, or its interface doesn't suit per-object tracking), that's a
  finding to raise explicitly (extend that service, don't duplicate it) rather than quietly
  building a second execution path.
