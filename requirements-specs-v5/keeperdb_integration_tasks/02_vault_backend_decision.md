# Task #2 — [!] Vault backend decision: KSM vs. self-hosted AES-256-GCM vs. other

**Reference:** TRD §10 Assumptions, §11 Risks. Same decision category
`requirements-specs/connector_tasks/02_secret_manager_integration.md` already gated behind a
human sign-off since 2026-07-06 — this task is that same gate, now with a concrete, evidenced
option (Keeper Secrets Manager) instead of an abstract "external vault, TBD which one."

## ⚠️ Decision needed before implementing Task #3, #6, #7

**The specific decision needed from you (repo owner / Security stakeholder):**

Does dataPlane adopt **Keeper Secrets Manager (KSM)** as the external vault backend for connector
credentials, or does the self-hosted "Implementation #1: AES-256-GCM envelope encryption" option
already scoped in `connector_tasks#2` remain the answer (at least for now)? A third option — a
different external vault (HashiCorp Vault, AWS Secrets Manager) — is also still on the table per
that task's original framing.

This is the same kind of hard-to-reverse decision `connector_tasks#2` already flagged: migrating
live credentials from one storage scheme to another after connections exist and pipelines depend
on them is exactly the class of action this repo's other sign-off gates (mapper tenant isolation,
schema intel PII, Pipelines execution semantics) exist to catch before, not after, implementation.

### What's genuinely new here vs. `connector_tasks#2`'s original framing

- **KSM has a real, documented, MIT-licensed Python SDK** (`keeper-secrets-manager-core`) —
  this wasn't evaluated in the original `connector_tasks#2` write-up, which spoke only in the
  abstract about "HashiCorp Vault, AWS Secrets Manager, etc."
- **KSM gives centralized rotation for free** — "rotate once, everyone gets the new value" — which
  would shrink `connector_tasks#8`'s scope rather than requiring dataPlane to build its own
  rotation logic per connector type.
- **KSM introduces an external dependency and a real (if zero-knowledge) third-party vault
  relationship** — a cost/ops trade-off the zero-external-infrastructure AES-256-GCM option
  deliberately avoided.

### Trade-off summary for the decision-maker

| | Self-hosted AES-256-GCM (`connector_tasks#2` Impl #1) | Keeper Secrets Manager |
|---|---|---|
| External infrastructure | None | Requires a KSM tenant (hosted or self-hosted gateway) |
| Rotation | dataPlane builds/owns rotation logic (`connector_tasks#8`) | KSM owns rotation; dataPlane calls `rotate()` + re-fetches |
| Key management | `SECRETS_ENCRYPTION_KEY` env var, manual rotation | Zero-knowledge vault, Keeper manages key material |
| Vendor dependency | None | Real (Keeper Security) |
| Effort to ship | Lower (already fully scoped in `connector_tasks#2`) | Slightly higher (new SDK, new config surface) |
| Compliance posture | Self-managed, may not satisfy "external vault required" policies | Purpose-built vault product, audit trail, zero-knowledge |

Until this is confirmed, **treat Tasks #3, #6, and #7 as blocked.** Task #1 (the interface) is
safe to build regardless — see design decision #1 in `INDEX.md`.

## Verify

N/A — this is a decision task, not an implementation task. "Done" means an explicit answer is
recorded here and in `INDEX.md`'s progress log, not that code was written.

## Risk

**High** — same risk class `connector_tasks#2` already identified: this is genuinely hard to
reverse once connections exist and pipelines depend on them.
