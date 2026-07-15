# Task #4 — Data-quality rule proposal derived from real profiling statistics

**Reference:** TRD §5 FR3; INDEX.md design decision #11 (confidence, not false certainty).
Depends on #2 (enriched profiling) and #3 (plan structure to populate).

**Goal:** Populate a `SchemaDesignPlan`'s `dq_rules` from the *actual* profiling statistics of the
columns feeding each proposed target column — every rule must cite the number that justifies it.

## Changes

### 1. New: `dq_rule_proposer.py` (or a method on the planning engine from #3)
- For each proposed target column with a `source_ref`, look up that source column's (enriched, per
  #2) profile and propose rules with an explicit justification and confidence, e.g.:
  - `null_rate` near 0 → propose `NOT NULL`, citing the exact rate (e.g. "0.02% null over 50,000
    sampled rows").
  - `uniqueness_ratio` near 1.0 → propose `UNIQUE`, citing the ratio and sample size — **never**
    assert this as certain; state it as "appears unique in the profiled sample," since a sample is
    not a full-table guarantee.
  - `fk_candidates` entries above a confidence threshold → propose a foreign-key constraint,
    citing the overlap ratio, explicitly flagged as inferred, not verified.
  - Duplicate-value findings (from #2) → propose a dedup step ahead of load, not a constraint on
    the target (constraints don't fix existing duplicate source data).
- Every proposed rule must carry its justification and confidence inline in the plan — this is
  what makes "based on profiling" a defensible claim in the UI (#6), not just a marketing line.
- No profiling data available for a given source column → no rule proposed for it, with an explicit
  note in `confidence_notes` (e.g. "no profile for `raw_orders.notes` — scan/profile this
  connection to get DQ suggestions for it") rather than silently guessing or omitting without
  explanation.

### 2. Tests
- Unit tests per rule type (NOT NULL, UNIQUE, FK, dedup) against synthetic profile fixtures,
  including the "no profile available" no-guess case.

## Verify

```bash
cd backend && pytest tests/agentic_dba/test_dq_rule_proposer.py -v
```

## Risk

- Thresholds (what null_rate counts as "near 0," what uniqueness_ratio counts as "near 1.0," what
  FK overlap ratio counts as "confident enough to propose") are product judgment calls, not purely
  technical ones — pick defensible starting values, document them plainly in code comments, and
  expect them to need tuning after real usage, not treat them as final.
