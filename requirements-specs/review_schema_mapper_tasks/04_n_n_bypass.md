# Task #4 — Close N:N bypass in `accept_suggestion` (FR3 violation)

**Reviewer finding:** §11.4 (CRITICAL). `MappingService.accept_suggestion`
calls `_add_edge_internal` specifically to skip the many-to-many guard
that `add_edge` enforces. The justification in the code is:

> "Skip the N:N guard since suggestion sources are unique to this target."

That invariant is **not actually enforced** anywhere. `suggest_mappings_task`
computes the best source match independently per target column — nothing
prevents two different target columns from both getting the same best-
matching source column. Accepting both creates a genuine many-to-many
mapping through a path that has no guard at all, violating FR3.

## Changes

### 1. `backend/app/services/mapping_service.py`
- Extract the N:N check from `add_edge` into a private helper
  `_check_no_many_to_many(db, mapping_id, target, sources)`.
- Call it from both `add_edge` AND `_add_edge_internal` (which
  `accept_suggestion` uses). Delete the misleading comment that
  justified skipping it.

### 2. `backend/tests/mapping/test_mapping_service.py`
- `test_accept_suggestion_blocks_second_suggestion_with_same_source`:
  creates two `AISuggestion` rows with **the same** source column but
  **different** target columns, accepts the first, and asserts that
  accepting the second raises HTTPException(409). This is the exact
  bypass path the reviewer flagged.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 85+/85+.

## Risk

- This **tightens** the AI-suggestion acceptance path. A user who tries
  to accept two high-confidence suggestions that share a source column
  will now get a clean 409 with a clear "many-to-many is not supported"
  message instead of a silently-violating mapping. This is the intended
  behavior per FR3.
- The existing `_check_no_many_to_many` logic in `add_edge` already
  handles the edge cases (same source, different target → block; same
  target, different source → allow). The extracted helper preserves this.
