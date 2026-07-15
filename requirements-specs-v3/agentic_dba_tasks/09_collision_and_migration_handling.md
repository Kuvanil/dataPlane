# Task #9 — Collision detection + migration (`ALTER`) path + per-object apply tracking

**Reference:** TRD §5 FR7, §6 NFR (reliability), §11 Risks; INDEX.md design decisions #5, #6.
Depends on #7 (the execution path this augments).

**Goal:** Two related reliability problems in one task: (a) a plan proposing a table/schema name
that already exists must not blindly re-issue `CREATE TABLE`, and (b) a partial failure across a
multi-table plan must be reported precisely, not opaquely.

## Changes

### 1. Collision detection — `agentic_dba_engine.py` (task #3) or a pre-execution check in
   `agentic_dba_execution_service.py` (task #7)
- Before generating/executing DDL for a proposed table, check the target connection's existing
  catalog (Schema Intel's already-scanned metadata, or a live check if unscanned) for a name
  collision.
- On collision: don't propose `CREATE TABLE`. Instead, reuse
  `schema_mapper_service.generate_migration_sql`'s existing precedent (`schema_mapper_service.py:
  186-253`, already emits real `ALTER TABLE ADD COLUMN`/`ALTER COLUMN` DDL from a diff) to propose
  an `ALTER`-based migration bringing the existing table in line with the plan's proposed columns,
  presented in the plan (task #6) as a distinct "this table already exists — here's the proposed
  migration instead" artifact, not silently substituted without the user noticing the difference.

### 2. Per-object apply tracking — extends task #7's execution service
- Track each proposed table's apply status independently: `pending → applied | failed`, mirroring
  `PipelineRunStep`'s per-step (`extract|transform|load`) tracking model
  (`backend/app/models/pipeline.py:162`) — same pattern, applied to schema objects instead of
  pipeline stages.
- On a mid-plan failure (table 3 of 5 fails), **stop** rather than continuing blindly past a
  failure whose cause might affect later objects (e.g. a schema-level permission issue), and report
  exactly which objects succeeded/failed/were skipped — never an opaque single pass/fail for the
  whole plan.
- Surface this per-object status in the plan card (task #6) — a plan that's `partially_applied`
  needs its own distinct visual state, not just "applied" or "failed."

### 3. Tests
- `backend/tests/agentic_dba/test_collision_and_migration.py` — collision correctly routes to
  migration-SQL generation instead of `CREATE TABLE`; a synthetic mid-plan execution failure
  produces the correct per-object status breakdown and stops rather than continuing.

## Verify

```bash
cd backend && pytest tests/agentic_dba/test_collision_and_migration.py -v
```
Manually: approve a plan proposing a table name that already exists in the target connection;
confirm a migration is proposed instead of a duplicate-create attempt/failure.

## Risk

- Deciding exactly when to "stop vs. continue past a failure" is a real design choice, not
  obviously correct either way — stopping is the safer default (per this task's framing above) but
  confirm this reasoning holds once real usage patterns are observed; don't treat it as beyond
  reconsideration.
