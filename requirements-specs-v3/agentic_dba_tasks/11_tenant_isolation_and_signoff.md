# Task #11 — Tenant-isolation cross-reference + security/governance sign-off

**Status: `[!]` blocked — do not auto-implement.** Reference: TRD §11 Risks; INDEX.md design
decision #7.

## Why this is blocked, not just "low confidence"

This repo already has a deliberately deferred architecture decision at
`requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (row-level `tenant_id` +
Postgres RLS, per that document, still awaiting Security/Product sign-off). Per `MEMORY.md`'s log,
six prior epics independently hit the same gap and correctly stopped to cross-reference it rather
than solving or silently ignoring it: Schema Mapper (`mapper_tasks/07`), Schema Intel
(`schema_intel_tasks/09`), Connectors (`connector_tasks/10`), Dashboard (`dashboard_tasks/09`),
Autopilot (`ai_autopilot_tasks/11`), and the original schema-mapper review
(`review_schema_mapper_tasks/CONTRADICTIONS.md` §C4).

This epic is the **seventh** to hit it, and arguably the highest-stakes one yet: it's a capability
that *creates new schema objects* based on an LLM-assisted plan. Without resolved tenant isolation,
there is no architectural guarantee that a generated plan, its profiling grounding, or its created
tables are correctly scoped to the requesting user's tenant — a real risk, not a theoretical one,
if this platform is ever used multi-tenant before that decision lands.

## What this task actually is

1. **Cross-reference, don't re-litigate.** Add a line in
   `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (or its `INDEX.md`)
   noting this epic as the seventh dependent, same as the others did — don't restate the finding as
   if it were new.
2. **Security sign-off on the approval-gate design itself**, independent of tenant isolation:
   review that `schema_design_create`'s `auto_capable=False` hardcoding (task #7) is genuinely
   unbypassable (not just a default someone could flip), that plan generation's metadata-only
   grounding (decision #3) actually holds in the implemented prompt (no accidental row-data
   leakage into the LLM context), and that the execution path's role-gating (task #7) matches Query
   Studio's existing bar, not a weaker one.
3. **Do not ship any execution capability (task #7 onward) to a multi-tenant deployment** until
   both this cross-reference and the tenant-isolation decision itself are resolved. A
   single-tenant/dev-only deployment is not blocked on this — flag the distinction explicitly
   wherever this epic's capabilities are documented/released.

## Verify

N/A — this is a review/documentation task, not a code change. "Done" means the cross-reference
exists and a human has actually reviewed and signed off, not that a checkbox was marked.

## Risk

- The temptation here is to treat this as "just paperwork" and proceed with implementation anyway.
  Don't. This repo's own established pattern (six prior instances) treats this exact gap as a hard
  stop for multi-tenant readiness, not a formality — this epic should hold to the same bar rather
  than being the exception.
