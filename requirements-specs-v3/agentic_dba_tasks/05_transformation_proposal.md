# Task #5 — Transformation proposal using the existing `TransformationPayload` grammar

**Reference:** TRD §5 FR3, §12 Technical Notes ("reused grammar, no new transformation DSL");
INDEX.md audit of `transformation_grammar.py`. Depends on #3 (plan structure to populate).

**Goal:** For each proposed target column with a `source_ref`, propose a transformation expressed
in the **existing** `TransformationPayload` grammar (`direct/cast/concat/substring/coalesce/upper/
lower/trim/default/null_if/lookup` — `transformation_grammar.py:16-19`) — no new transformation
language, since Schema Mapper's editor/validation/execution already understands this one.

## Changes

### 1. New: `transformation_proposer.py` (or a method on the planning engine from #3)
- Same source/target column, same type → `{kind: "direct"}`.
- Compatible but different type (e.g. source `varchar`, target `numeric`) → `{kind: "cast", from,
  to}`.
- Multiple source columns feeding one target column (e.g. `first_name` + `last_name` →
  `customer_full_name`) → `{kind: "concat", parts: [...]}` — reuse the exact same
  multi-source-edge convention Schema Mapper's Canvas already established for N:1 mappings
  (`mapper_tasks/01`) rather than inventing a second multi-source representation.
- A `dq_rules`-proposed dedup/null-handling step (from #4) that's expressible as a transform (e.g.
  `coalesce`/`null_if` for a default-value fallback) → wire it in as the corresponding
  transformation kind rather than only representing it as a plan-level note.
- A source/target relationship this grammar genuinely can't express → don't force a wrong
  transformation; leave the target column's transformation unset with an explicit
  `confidence_notes` entry saying manual authoring will be needed once the mapping is created (task
  #8) — false confidence here is worse than an honest gap.

### 2. Tests
- Unit tests per transformation kind selection given synthetic source/target column pairs,
  including the multi-source concat case and the "can't express, leave for manual authoring" case.

## Verify

```bash
cd backend && pytest tests/agentic_dba/test_transformation_proposer.py -v
```

## Risk

- Low — this task is mechanical once #3's plan structure exists, since it's selecting from an
  already-well-defined, already-validated grammar rather than designing a new one.
