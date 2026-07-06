# Bug #18 — `changed_tables` misses column-level drift (MEDIUM)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Affects FR2 report actionability.

## Current state

`_diff_table_names` only diffs top-level table **names** (symmetric difference of keys). A
type change or an added/removed column inside an existing table produces
`has_drift=true, changed_tables=[]` — the user gets "source schema has changed" with nothing
actionable. Task #2's spec asked to name drifted tables/columns "if cheaply derivable from a
schema diff", and it is cheap: per-table comparison of the normalized column lists.

## Fix

Replace `_diff_table_names` with `_diff_tables(baseline, live)` returning the sorted union of:
- tables present in exactly one side (existing behavior), and
- tables present in both whose **normalized** column lists differ (reusing Bug #15's
  `_normalize_schema` so column order doesn't produce false entries).

`changed_tables` stays a `List[str]` (no schema change); per-column detail remains a possible
follow-up for the Task #7 UI, not needed for AC2.

## Verify

`backend/tests/pipelines/test_drift_validation.py`: type-changed column → its table appears
in `changed_tables`; added column → table listed; shuffled column order → not listed.

## Risk

Low, additive to the response payload's usefulness only.
