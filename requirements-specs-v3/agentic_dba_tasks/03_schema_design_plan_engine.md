# Task #3 — `SchemaDesignPlan` model + deterministic-first planning engine

**Reference:** TRD §5 FR2/FR3, §12 Technical Notes; INDEX.md design decisions #3, #9, #11.
Depends on #1 (classified intent to act on) and #2 (real profiling to ground against).

**Goal:** Given a request classified `"schema_design"`, produce a structured, reviewable
`SchemaDesignPlan` — the core artifact every later task (#4-#9) reads or writes.

## Changes

### 1. New model/schema: `SchemaDesignPlan`
- Fields (indicative, refine during implementation): `id`, `session_id` (ties to AskData's existing
  conversation context), `source_connection_id`, `status` (`draft | approved | rejected |
  partially_applied | applied`), `proposed_tables: list[ProposedTable]` where `ProposedTable` has
  `name`, `columns: list[{name, type, nullable, source_ref: {table, column} | null}]`, `dq_rules`
  (populated by task #4), `transformations` (populated by task #5), `generated_ddl: str`,
  `confidence_notes: list[str]` (plain-language caveats — e.g. "FK relationship to `customers.id`
  is inferred at 87% confidence, not verified"), `created_at`, `decided_at`, `decided_by`.
- Persist this — it must survive across chat turns for decision #10 (stateful, editable plans) and
  be independently reviewable/approvable outside the chat flow if needed (e.g. from an approval
  queue UI, mirroring Autopilot's).

### 2. New service: `agentic_dba_engine.py` (or similar)
- `generate_plan(question, connection_id, session_id) -> SchemaDesignPlan`, run as an async Celery
  task (NFR: don't block the chat request) with the chat response initially returning a
  `plan_id` + `status: "generating"` the frontend polls (task #6 consumes this).
- **Template-first (decision #11):** maintain a small library of recognized domain templates (start
  with one: a generic retail/e-commerce analytics star schema — dimension tables for
  customers/products, a fact table for orders/order_items — as a *starting draft*, not a rigid
  output). Match the request's domain language against the template library; if no template
  matches, fall back to a purely catalog-driven proposal (restructure/rename what's discovered,
  don't invent domain concepts from nothing).
- **LLM-assisted adaptation:** feed the matched template (or catalog-only baseline) plus the actual
  discovered catalog (table/column names, types, classifications, profiling stats from #2) to the
  LLM to adapt column names/types to what's actually there — grounded strictly in that metadata,
  never in row-level values (decision #3). Cap prompt size by summarizing/paginating the catalog if
  large (NFR).
- **Sanity caps:** hard limit on proposed table/column counts per plan (decision #11) — if the
  adaptation would exceed it, truncate and note the truncation explicitly in `confidence_notes`
  rather than silently dropping content (matches the "no silent caps" principle other epics in this
  repo already follow for bounded results).
- Missing/ambiguous source connection or no profiling data yet → don't guess; return a
  clarifying-question response instead of a plan (wired properly once task #10 lands; for this
  task, a simple explicit check-and-ask is enough — don't block on #10's full registry).

### 3. Tests
- `backend/tests/agentic_dba/test_plan_engine.py` — template-matched case (retail keywords → the
  seeded star-schema template, adapted to a fixture catalog), catalog-only fallback case (no
  template match), sanity-cap truncation case, missing-connection clarifying-question case.

## Verify

```bash
cd backend && pytest tests/agentic_dba/ -v
```
Manually: run the retail-analytics example end-to-end through this task's new service directly
(not yet through chat, since #6 isn't built) and inspect the generated `SchemaDesignPlan` for
sensible table/column proposals grounded in a real seeded catalog.

## Risk

- This is the highest-risk task in the epic (per INDEX.md confidence notes) — the LLM-adaptation
  prompt design is genuinely hard to get right (stay grounded, stay bounded, stay useful). Budget
  real iteration time; don't treat the first working version as final without exercising it against
  more than one domain/catalog shape.
- Async task design means the chat UX needs a "still working" state — coordinate with task #6
  before finalizing the polling contract (plan `status` values, expected latency) so the frontend
  isn't guessing at semantics.
