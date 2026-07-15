# Agentic DBA Copilot — Validation Bugs (second pass)

Second validation pass, 2026-07-15. The first pass (`bugs.md`) found no v3
runtime defects in its automated sweep; this deeper adversarial review of the
generation/execution paths found and fixed four correctness defects and
documents one lower-severity issue. Every claim below was traced end-to-end in
the code and each fix carries a regression test. Full-suite result after fixes:
backend `pytest` 811/811.

The tenant-isolation/security sign-off item (Task #11) remains blocked by
design; it is not reclassified here as an implementation bug.

---

## BUG-01 — `uniqueness_ratio` understated on large tables, silently disabling the UNIQUE/DEDUPE DQ rules  ✅ FIXED

- Severity: Medium-High (correctness — defeats "based on profiling" on the
  exact large fact tables the feature targets)
- Where: `app/services/profiling_enrichment.py:compute_uniqueness_ratio`,
  called from `app/tasks/schema_intel_tasks.py:profile_column_task`.
- Cause: `uniqueness_ratio = distinct_count / row_count`, but the two inputs
  come from different populations. Every connector computes `distinct_count`
  as `COUNT(DISTINCT c)` over a subquery bounded by `distinct_scan_limit`
  (default `SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS = 100000`), while `row_count`
  is the full `COUNT(*)`.
- Failure scenario: a 1,000,000-row table with a genuinely-unique key column →
  `distinct_count` caps at 100,000, `row_count` = 1,000,000 →
  `uniqueness_ratio = 0.1`. `dq_rule_proposer` requires `>= 0.99` for the
  `unique` rule and `0.9 <= ratio < 1.0` for `dedupe`, so **neither can ever
  fire** on any table larger than the scan cap. The ratio can only understate,
  so no false constraints are produced — but the whole uniqueness/dedupe half
  of DQ proposal is silently dead on large tables.
- Fix: `compute_uniqueness_ratio` now takes the scanned-population size and
  divides by `min(row_count, scanned_rows)` — the population the distinct
  count was actually measured over. Small tables (below the cap) are unchanged.
- Regression test:
  `tests/schema_catalog/test_profiling_enrichment.py::test_uniqueness_ratio_uses_scanned_population_on_large_tables`.

## BUG-02 — LLM-supplied column `type` bypassed grounding validation and flowed verbatim into generated DDL  ✅ FIXED

- Severity: Medium (contract #7 grounding gap / defense-in-depth)
- Where: `app/services/agentic_dba_engine.py:_validate_llm_tables` (type taken
  as `str(col.get("type") or "TEXT")` with no validation), reaching
  `_dialect_type` / `_create_table_statement` / `_migration_statements`.
- Cause: `_validate_llm_tables` strictly validated table/column **names**
  (`_IDENT_RE`) and required every `source_refs` entry to exist in the catalog,
  but passed the column **type** through unchecked. A crafted type such as
  `"TEXT); DROP TABLE users; --"` failed `_dialect_type`'s base-type regex and
  fell through to `mapping.get(base, raw)`, embedding the raw string in the
  `CREATE TABLE` body.
- Calibration: not exploitable RCE — `query_execution_service.execute` rejects
  multi-statement SQL downstream, so the crafted DDL fails at apply time
  (→ `partially_applied`). But contract #7 says an ungrounded adaptation must
  fail validation and fall back to the deterministic proposal, not produce
  corrupt DDL. The grounding gate was thinner than documented.
- Fix: added `_TYPE_RE` (a plain SQL type token, optionally with
  precision/scale). A column whose `type` doesn't match rejects the whole LLM
  adaptation (`return None`), exactly as an ungrounded `source_ref` already
  does; the deterministic proposal stands with the existing honest note.
- Regression test:
  `tests/agentic_dba/test_plan_engine.py::test_llm_unsafe_type_is_rejected`.

## BUG-03 — Schema-design requests naming a SaaS as their data domain were misrouted to the ACI approval queue  ✅ FIXED

- Severity: Medium (cross-epic: v4's `external_action` intent layered over v3's
  classifier)
- Where: `app/services/dba_intent_classifier.py` — `_match_external_action`
  added a `+1` score bonus **and** `external_action` held the highest
  tie-break priority (20 vs `schema_design`'s 10).
- Cause: arbitration is `(score, priority)`. The `+1` bonus let
  `external_action` win even when `schema_design` had an equal-or-stronger
  raw signal, and priority broke genuine ties toward `external_action` too.
- Failure scenario: *"create target tables for our jira ticketing data"* →
  `external_action` (create + jira) scored `2+1=3` vs `schema_design`
  (create + target tables) `2`, so a schema-design request was routed to
  `_handle_external_action` and queued as an ACI recommendation instead of
  generating a design plan. Any schema-design request whose data domain is a
  ticketing/issue/Slack/webhook system was affected.
- Fix: removed the `+1` bonus (arbitrate on raw signal strength) and made
  `schema_design` win ties over `external_action` (priority 20 vs 10). A
  genuinely-outbound request uses a non-build verb ("open a github issue…",
  "post to #ops"), so it still wins `external_action` outright on score; a
  "create X" request that names both a schema object and a tool now correctly
  resolves to schema design. All existing external-intent tests still pass.
- Regression test:
  `tests/askdata/test_external_action_intent.py::test_schema_design_naming_a_saas_domain_is_not_external`.

## BUG-04 — Concurrent double-approval of a plan could double-apply its DDL  ✅ FIXED

- Severity: Medium-Low (race; low probability but real duplicated execution)
- Where: `app/services/agentic_dba_execution_service.py:approve_and_execute_plan`.
- Cause: the function read `plan.status`, checked `!= "ready"`, set `applying`,
  and committed with no row lock or compare-and-swap. Two simultaneous admin
  approvals could both pass the `status == "ready"` check before either
  committed, so both ran the DDL loop; the second run's statements fail
  (table/column exists) and the final `apply_results`/`status` are whatever
  commits last — duplicated execution and a nondeterministic record.
- Fix: the plan row is now selected `with_for_update()` before the status
  transition, serializing concurrent approvals (harmless no-op on SQLite,
  enforced on Postgres). The second approval blocks, then sees `applying`/
  `applied` and returns 409.
- Note: covered by the existing approval tests plus inspection; a true
  two-transaction race isn't deterministically reproducible on the SQLite test
  DB, but the lock is a no-op there and correct on Postgres.

---

## Documented (not fixed this pass)

### BUG-05 — SQLite type-change collision object reported `applied` though nothing executed  (Low)

- Where: `agentic_dba_execution_service.py` apply loop + engine
  `_migration_statements` (SQLite type change emitted as a comment statement).
- Behavior: for a collision whose only change is a SQLite column-type
  migration, `_migration_statements` emits a comment (`-- ALTER … unsupported
  in SQLite`) plus a warning note; the apply loop skips comment statements, so
  `executed=0`, `error=None` → the object is marked `applied` and counts toward
  `plan.status = "applied"`. The type change was never performed; the warning
  is only in `confidence_notes`. (The same mechanism marks an all-columns-
  already-exist migrate object `applied` with 0 statements, which is arguably
  correct.)
- Why deferred: distinguishing a legitimate no-op ("target already matches")
  from an intended-but-unexecutable change requires tracking skipped-comment
  statements per object and adding a `partially_applied`/`skipped` per-object
  state; that changes apply-status semantics and is disproportionate to the
  impact (SQLite-only, warning already surfaced). Recommended fix: when a
  migrate object executed 0 real statements but had comment-only
  (unexecutable) statements, report per-object status `skipped`, not `applied`.
