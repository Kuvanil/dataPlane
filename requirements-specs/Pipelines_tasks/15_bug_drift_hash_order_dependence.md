# Bug #15 — Drift hashes are column-order-dependent while `has_drift` is not (MEDIUM)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Affects FR2 / AC2 signal quality.

## Current state

`compute_schema_hash`'s docstring claims order-independence, but
`json.dumps(sort_keys=True)` only sorts **dict keys** — reordering a table's column *list*
changes the hash. Meanwhile `has_drift` is computed with the order-tolerant `_schemas_equal`.
So `GET /pipelines/{id}/drift` can return `has_drift=false` with
`baseline_hash != current_hash` — a contradictory signal for the UI and for anyone comparing
hashes, and the docstring is simply wrong.

## Fix

Add a `_normalize_schema(schema)` step used by `compute_schema_hash`: sort each table's
column list deterministically (by JSON serialization of each column dict, which handles any
shape including missing `name` keys), leaving dict-key sorting to `json.dumps`. Then
`baseline_hash == current_hash ⟺ no drift`, and `has_drift` can be derived **from the same
normalized comparison** (see Bug #16 — this fix and that one share the normalization and
retire `_schemas_equal` together).

## Verify

`backend/tests/pipelines/test_drift_validation.py`: same schema with shuffled column order →
identical hash and `has_drift=false`; genuinely changed column → differing hash and
`has_drift=true`. Assert the invariant `has_drift == (baseline_hash != current_hash)` in the
no-drift and drift tests.

## Risk

Low. Hashes recorded before this fix (none persisted today — they're response-only) don't
need migration.
