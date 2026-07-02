# Task #2 — Produce `lossy_warning` verdict (FR7/AC3 fix)

**Reviewer finding:** §11.2 (CRITICAL). The TRD FR7 and AC3 distinguish two failure tiers:

- **blocking error** — incompatible types that need a cast to make sense
  (e.g. TEXT→INTEGER, TEXT→DATE)
- **warning** — lossy conversions that are common and safe but lose precision
  (e.g. INTEGER→TEXT, FLOAT→INTEGER, TIMESTAMP→DATE)

The current `validate_edge` collapses both into `blocking`, which is overly
strict — it makes legitimately common mappings (e.g. an INTEGER→TEXT
copy of a numeric ID for display) unpublishable without a redundant
explicit `cast` transform, contradicting the spec's intent.

## Changes

### 1. `backend/app/services/mapping_validation_service.py`
- `validate_edge` keeps lossy-without-cast at `lossy_warning` (was escalated
  to `blocking`).
- The "no cast" escalation only fires for **incompatible** types, not lossy.
- The previous `blocking` verdict for lossy-without-cast becomes
  `lossy_warning` with a clear message that tells the user to add a CAST to
  acknowledge or leave as a warning.

### 2. `backend/tests/mapping/test_mapping_validation_service.py`
- `test_int_to_text_is_lossy_warning_without_cast`: the assertion was
  `blocking` (matching the bug). Change to `lossy_warning`. The test name
  was always the intended behavior — only the assertion was wrong.
- Add a companion `test_int_to_text_without_cast_publishes_with_warning`
  that confirms a mapping with a `lossy_warning` edge can still be published
  (the publish gate is `blocking_count > 0`, not `warning_count > 0`).

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 72+/72+.

## Risk

- This **loosens** the publish gate. Previously some mappings that were
  silently blocked at the server now publish with a visible warning that the
  UI must surface. The UI already does — `useMapping.validate` displays
  `warning_count` (useMapping.ts:410-419) and `WorkspaceHeader` shows a warning
  badge. So this is purely a backend fix; the UI already accommodates it.
