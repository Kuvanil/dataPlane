# Bug #14 — `create_pipeline` accepts mappings published against different connections (HIGH)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Affects FR1 + FR2 integrity.

## Current state

`PipelineCRUD.create_pipeline` validates that the source/target connections exist and that the
mapping is published, but never checks that the mapping *belongs to* those connections.
`Mapping` has `source_id` / `target_id` (`backend/app/models/mapping.py`), so a pipeline can
pin a mapping published against connections A→B while declaring source C and target D. The
drift check (Task #2) then compares C's live schema against A's snapshot — a guaranteed
spurious drift or a meaningless pass — and Task #3's executor would migrate the wrong data.

Edge case: `Mapping.source_id`/`target_id` are nullable (`ondelete="SET NULL"`) — a mapping
whose original connection was deleted has no usable baseline identity.

## Fix

In `create_pipeline`, after `_resolve_published_version`:

- 422 if `mapping.source_id is None or mapping.target_id is None` ("mapping's original
  connections no longer exist; re-publish against current connections").
- 422 if `mapping.source_id != source_connection_id` or
  `mapping.target_id != target_connection_id`, naming both sides in the detail.

## Verify

New tests in `backend/tests/pipelines/test_pipeline_crud.py`: mismatched source, mismatched
target, and null mapping connection each → 422; matching pair still creates.

## Risk

Low. One deliberate scope call: we require exact connection match rather than allowing
"compatible schema on a different connection" — the TRD's FR1 says a pipeline is created
*from* a published mapping, so inheriting its connections is the contract.
