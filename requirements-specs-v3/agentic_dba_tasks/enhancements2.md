# Agentic DBA Copilot — Enhancements (second pass)

Second-pass findings, 2026-07-15. These are robustness/quality improvements
surfaced during the deeper validation review, not correctness defects (those
are in `bugs2.md`). The first pass's open items in `enhancements.md`
(provisioned-DB end-to-end run; Task #11 tenant isolation) still stand.

## Open

1. **Reaper/timeout for stuck `generating` plans.** `create_plan` commits a
   plan row with `status="generating"` and *then* the caller dispatches the
   Celery task (`agentic_dba.py:dispatch_plan_generation`,
   `askdata_pipeline_service._dispatch_plan_generation`). If `.delay()` raises
   (broker unreachable), the HTTP handler 500s but the committed plan row is
   left in `generating` forever — nothing marks it `failed` and the plan-card
   UI polls indefinitely. Add a timeout/reaper (or dispatch inside a
   try/except that flips the row to `failed` on enqueue failure), and/or a
   watchdog that fails plans stuck in `generating` past a bound.

2. **LLM can still introduce invented columns via empty `source_refs`.**
   `_validate_llm_tables` accepts `source_refs: []` (legitimately needed for
   synthetic surrogate keys), so the LLM can add a column with a valid
   identifier name and no catalog basis. Effect is benign — such a column gets
   no DQ rule and no transformation (both require `source_refs`), so it's an
   empty target column — but it's an un-flagged invented artifact, mildly at
   odds with the prompt's "DO NOT invent columns" instruction. Consider
   flagging tables/columns that carry empty `source_refs` and aren't the
   declared surrogate key, or annotating them as "synthetic (no source)" in
   the plan card so review is explicit.
