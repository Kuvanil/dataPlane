# Task #2 — Profiling enrichment: uniqueness ratio, duplicate sampling, FK-candidate inference

**Reference:** TRD §5 FR2 (grounding), §6 NFR (profiling depth); INDEX.md audit point on
`schema_catalog.py`'s thin `ColumnProfile`.

**Gap:** `ColumnProfile` (`backend/app/models/schema_catalog.py:86-113`) has only
`null_count/null_rate/distinct_count/min_value/max_value/sample_size_used`. `distinct_count` exists
but nothing computes a **distinct/row-count ratio**, samples for **duplicate rows**, or infers
**foreign-key candidates** via value-overlap against other tables' primary keys. Without these,
"based on profiling" DQ proposals (task #4) would be asserting confidence the data doesn't support.

## Changes

### 1. `backend/app/models/schema_catalog.py`
- Extend `ColumnProfile` with: `uniqueness_ratio: float | None` (distinct_count / row_count),
  `row_count: int | None` (needed to compute the ratio and to report it directly), `fk_candidates:
  list[FKCandidate] | None` where `FKCandidate` is a small nested schema
  (`{table, column, overlap_ratio}`). All nullable/additive — this is the same "additive change to
  an already-populated table" gotcha every prior epic in this repo has hit; a manual `ALTER TABLE`
  will be needed on any running dev Postgres (record the exact SQL in the progress log, per
  established convention).

### 2. `backend/app/services/schema_catalog_service.py` (or wherever profiling execution lives —
   confirm exact file before editing; the research audit found no profiling *computation* in this
   file, only structural scan — profiling itself may live in a Celery task, check
   `backend/app/tasks/` first)
- Add `row_count` (cheap `COUNT(*)`, already bounded by existing profiling sample-size logic) and
  `uniqueness_ratio` computation to the existing profiling pass.
- Add duplicate-row sampling: for columns/column-groups flagged as candidate natural keys (e.g.
  `uniqueness_ratio` near but not exactly 1.0), sample a bounded set of actual duplicate values
  (not full rows — same metadata/statistics-only principle as decision #3, this reports *that*
  duplicates exist and roughly how many, not necessarily the row content itself unless already
  permitted by existing profiling's data-access model — confirm what today's profiling already
  reads before deciding how far this extends).
- Add FK-candidate inference: for each column, compare its distinct value set (or a bounded sample)
  against other tables' primary-key columns in the same connection; report a confidence ratio, not
  a boolean. Bound this — an O(columns × tables) comparison needs a sane cap (e.g. only compare
  against declared PK columns, not every column of every table) to avoid a combinatorial profiling
  blowup on a large catalog.

### 3. Tests
- `backend/tests/schema_intel/` (or wherever existing profiling tests live) — new tests for
  uniqueness ratio computation, a synthetic duplicate-value case, and a synthetic FK-candidate case
  (e.g. a `customer_id` column whose values are a subset of a `customers.id` PK column).

## Verify

```bash
cd backend && pytest tests/schema_intel/ -v  # or wherever profiling tests land — confirm path
```
Manually: profile a seeded connection with a known FK relationship and a column with a few
duplicate values; confirm the new fields populate sensibly.

## Risk

- FK-candidate inference is a heuristic, not ground truth — false positives are likely on small/
  synthetic datasets. The plan-generation consumer (task #4) must treat this as a *hint with a
  confidence score*, never an asserted fact, and the UI (task #6) must surface that confidence
  rather than presenting it as certain.
- Performance: profiling already exists and presumably has its own bounds/timeouts — this task adds
  to that cost. Confirm the existing profiling task's timeout/row-cap handling before adding
  cross-table comparison work, and reuse it rather than introducing a second timeout mechanism.
