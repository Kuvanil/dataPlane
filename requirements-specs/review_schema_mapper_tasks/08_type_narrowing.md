# Task #8 — Narrowing checks within type families (review §11.10)

**Reviewer finding:** §11.10 (MEDIUM). `_is_lossy` / `_is_incompatible`
operate on coarse type families. Same-family narrowing conversions
(`BIGINT → SMALLINT`, `DOUBLE → REAL`, `DECIMAL(18,4) → INTEGER`) all
fall through to the unconditional "ok" branch (`validate_edge`,
`mapping_validation_service.py:136-140`). Silent-truncation / overflow
risk at pipeline-execution time is invisible to the Schema Mapper's own
validation, contradicting FR7's intent to catch exactly this class of
issue.

## Changes

### 1. `backend/app/services/mapping_validation_service.py`
- Add `_INT_RANK` and `_FLOAT_RANK` ordering tables (higher rank = wider
  numeric type).
- Extend `_is_lossy` to detect within-family narrowing:
  - `BIGINT → SMALLINT`, `BIGINT → INTEGER`, `INTEGER → SMALLINT`, etc.
  - `DOUBLE → REAL`, `DECIMAL → INTEGER` (when precision would be lost).
- Narrowing that is *widening* (e.g. `INTEGER → BIGINT`) stays "ok" via
  `_is_lossless_widening`.

### 2. `backend/tests/mapping/test_mapping_validation_service.py`
- Add tests:
  - `test_bigint_to_smallint_is_lossy_warning`: narrowing int → smallint
    is lossy (overflow risk).
  - `test_int_to_bigint_is_ok`: widening int → bigint is ok.
  - `test_double_to_real_is_lossy_warning`: narrowing double → real is
    lossy (precision loss).
  - `test_same_type_is_ok` already covers the no-op case.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 100+/100+.

## Risk

- The `_INT_RANK` / `_FLOAT_RANK` tables are best-effort. Edge cases
  (`DECIMAL(p,s) → DECIMAL(p',s')` where p' < p) are out of scope; the
  reviewer explicitly listed only the common cases. If Pipelines later
  needs more granular decimal handling, extend the tables then.
- Narrowing changes a mapping's verdict from "ok" to "lossy_warning" —
  same UX impact as the #2 lossy_warning fix: the user sees the warning
  badge in the UI and can consciously accept it.
