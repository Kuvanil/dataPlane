# Task #10 — Tenant-isolation cross-reference + security sign-off

**Status: `[!]` blocked — do not auto-implement.** Reference: TRD §11 Risks; INDEX.md design
decision #7.

## Why this is blocked, not just "low confidence"

This repo already has a deliberately deferred architecture decision at
`requirements-specs/tenant_isolation_tasks/00_architecture_decision.md`. Per `MEMORY.md`'s log,
seven prior epics have independently hit this same gap and correctly stopped to cross-reference it
rather than solving or silently ignoring it: Schema Mapper, Schema Intel, Connectors, Dashboard,
Autopilot, the original schema-mapper review, and the Agentic DBA Copilot epic
(`requirements-specs-v3`). This epic is the **eighth**.

The specific new question this epic raises: **linked accounts are per-app, and this platform is
not yet architecturally tenant-scoped.** If dataPlane is ever deployed multi-tenant before that
decision lands, an ACI linked account (e.g. one customer's Slack workspace) must not be reachable
by another tenant's actions. Today, nothing in this epic's design enforces that boundary beyond
"don't build it that way" — which is not a substitute for an actual architectural guarantee.

## What this task actually is

1. **Cross-reference, don't re-litigate.** Add a line in
   `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (or its `INDEX.md`)
   noting this epic as the eighth dependent, same as the others did.
2. **Security sign-off on the external-credential surface specifically:** confirm ACI's own
   linked-account isolation model (per-linked-account OAuth tokens) is sound on its own terms, that
   Task #3's governance registry genuinely defaults to deny for anything not explicitly
   allow-listed, and that Task #4's `external_action` intent can't be tricked (e.g. via prompt
   injection in a chat request) into calling `execute_tool` against a linked account the requesting
   user shouldn't have access to — this specific risk is new to this epic and needs its own review,
   not just a rubber-stamp of the tenant-isolation cross-reference.
3. **Do not deploy any auto-capable external action (Task #3's narrow allow-listed subset) to a
   multi-tenant environment** until both this cross-reference and the tenant-isolation decision
   itself are resolved. A single-tenant/dev-only deployment is not blocked on this.

## Verify

N/A — review/documentation task. "Done" means a human has actually reviewed and signed off, not
that a checkbox was marked.

## Risk

- Same risk as every other epic that's hit this gap: the temptation to treat this as paperwork and
  ship anyway. This epic adds a genuinely new risk surface (external credentials, potential
  prompt-injection-to-wrong-linked-account) on top of the pre-existing tenant-isolation gap — hold
  this to at least the same bar as the seven prior instances, not a lower one.
