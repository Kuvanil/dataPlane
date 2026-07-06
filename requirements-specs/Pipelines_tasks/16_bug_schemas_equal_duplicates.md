# Bug #16 — `_schemas_equal` mishandles duplicates and is asymmetric (MEDIUM)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Affects FR2 core predicate.

## Current state

`_schemas_equal`'s list branch checks that every item of `a` matches *some* item of `b`, with
only a length guard. That is not multiset equality: baseline `[x, x]` vs live `[x, y]` passes
(each `x` in `a` matches the `x` in `b`) — a missed drift. It is also asymmetric
(`_schemas_equal(a, b) != _schemas_equal(b, a)` for such inputs). Practical likelihood is low
(column names are unique per table), but this is the core drift predicate and the O(n²)
matcher is more code than a correct implementation.

## Fix

Delete `_schemas_equal`. After Bug #15's `_normalize_schema` lands, drift is simply
`compute_schema_hash(normalize(baseline)) != compute_schema_hash(normalize(live))` — sorted
pairwise comparison handles duplicates correctly by construction, is symmetric, and removes
the O(n²) path entirely.

## Verify

`backend/tests/pipelines/test_drift_validation.py`: duplicate-column-dict regression test —
baseline `[x, x]` vs live `[x, y]` (same length) → `has_drift=true`. Existing
added/removed/type-changed tests keep passing.

## Risk

None beyond Bug #15's shared change; strictly less code after the fix.
