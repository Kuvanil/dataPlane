# Task #10 — [!] Tenant-isolation cross-reference

**Reference:** TRD §3 In-Scope, §11 Risks. Cross-reference, not a new task — same unresolved
architecture gap raised in `mapper_tasks/07`, `schema_intel_tasks/09`, `connector_tasks/10`,
`ai_autopilot`'s equivalent, the Agentic DBA Copilot epic (`requirements-specs-v3`), and the
ACI.dev epic (`requirements-specs-v4/aci_integration_tasks/10`) — the ninth epic in this repo to
hit this same gap.

## The gap, as it applies here specifically

Once connector credentials live in a vault (KSM or otherwise), the question of **per-tenant
scoping of vault records** becomes concrete: if/when dataPlane adopts multi-tenancy, does each
tenant get an isolated KSM "shared folder" / project (Keeper's own multi-tenant primitive), or does
a single dataPlane-wide KSM tenant hold every customer's connector credentials with only
application-layer scoping? The latter is a materially different risk profile — a single
authorization bug in `ConnectionService` could expose one tenant's database credentials to another,
with the vault itself providing no additional isolation boundary.

This epic's design (Tasks #1–#8) does not solve this — it inherits whatever the platform-wide
tenant-isolation decision (still `[!]` blocked everywhere else in this repo) ultimately resolves
to. Building vault-record-per-tenant scoping now, ahead of that platform-wide decision, risks
solving it inconsistently with however the rest of the platform ends up architected.

## What this task requires before the epic is considered fully closed

- Explicit sign-off (same stakeholder as every other tenant-isolation gate in this repo) that
  shipping single-tenant-shaped credential vaulting now is acceptable, with a documented follow-up
  to revisit vault-record scoping once/if the platform-wide tenant-isolation architecture is
  decided.
- No implementation work in this task beyond that documented acknowledgment — this is a decision
  gate, not a coding task, matching how every sibling `[!]` tenant-isolation task in this repo is
  handled.

## Verify

N/A — decision/documentation task.

## Risk

**High** (same severity every other tenant-isolation gate in this repo carries) — but the
mitigation is identical to those: don't silently bypass it, cross-reference it explicitly, and
gate any actual multi-tenant vault work behind the platform-wide decision once it lands.
