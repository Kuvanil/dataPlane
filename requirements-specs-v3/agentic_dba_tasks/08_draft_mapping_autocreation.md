# Task #8 — Auto-create a draft Schema Mapper mapping from an approved plan

**Reference:** TRD §5 FR6; INDEX.md design decision #2 (feed the existing lifecycle, don't build a
parallel one). Depends on #7 (target tables must actually exist and be queryable first).

**Goal:** Once a plan's target tables are created (task #7), turn its proposed transformations
(task #5) into an ordinary **draft** Schema Mapper mapping — the user then reviews/edits/validates/
publishes it exactly like any manually-created mapping. No new mapping storage, no new
review lifecycle.

## Changes

### 1. `agentic_dba_execution_service.py` (extends task #7's service)
- After all target tables in a plan are successfully created, call `MappingService.create` (or
  equivalent) to create a new draft `Mapping` with `source_id = plan.source_connection_id`,
  `target_id` = the connection the new tables were created in (same connection, if that's the
  actual architecture — confirm whether target tables land in the same DB/connection as the source
  or a genuinely separate target connection before assuming).
- For each proposed target column with a resolved transformation (task #5), call `add_edge` with
  that transformation — same function Schema Mapper's own UI/AI-suggestion-acceptance path already
  calls, so all of that path's existing validation (`_check_multi_source_kind`,
  `_check_target_not_mapped`, etc., per the mapper epic's own bug-fix history) applies here for
  free.
- For target columns task #5 left without a resolved transformation, leave that edge unmapped —
  the user completes it manually in Schema Mapper's normal editor, same as any other mapping with
  partial coverage.
- The mapping's origin should be distinguishable from a manually-created one for audit/UX clarity
  (e.g. reuse or extend `EdgeOrigin`/mapping-level metadata — check whether `Mapping` itself has a
  place for this, or whether it should live on the plan's own record pointing at the created
  mapping's id instead of modifying the `Mapping` model).

### 2. Tests
- `backend/tests/agentic_dba/test_mapping_autocreation.py` — confirm a created mapping has the
  right edges/transformations, confirm it's genuinely a `draft`-status mapping indistinguishable
  in the UI from a manual one (reuses `schema-mapper`'s existing rendering, not a special case),
  confirm partially-unresolved transformations leave the corresponding edge absent, not wrong.

## Verify

```bash
cd backend && pytest tests/agentic_dba/test_mapping_autocreation.py -v
```
Manually: after approving a plan end-to-end, open Schema Mapper and confirm the new draft mapping
appears, edits normally, and validates/publishes through the existing unmodified flow.

## Risk

- Confirm early whether this repo's Mapping model treats source and target as always-distinct
  connections, or whether "create a new target schema in the same database as the source" (which
  is what "create target schemas... in postgresql" most naturally reads as, if the source is
  already Postgres) is even a shape `MappingService`/`Mapping` currently expects — this could be a
  real modeling gap worth flagging rather than working around silently.
