# Task 11 — Security/Compliance sign-off — [!] blocked, human gate

**TRD:** §12 DoD ("Security/compliance sign-off on guardrails and prohibited-action
enforcement"), §9 assumptions (risk taxonomy, designated approvers), §3 Security/Compliance role.

Not auto-implementable by definition. Items needing a human decision/sign-off:

1. **Risk/reversibility taxonomy** (INDEX decision 3) — chosen conservatively by the
   implementing agent; a human must confirm `drift_rescan` and `mapping_suggestions_refresh`
   are acceptable as auto-capable in regulated deployments.
2. **Prohibited list completeness** — current set: connection deletes, mapping publish,
   user/role changes, credential/security changes, raw DDL. Compliance should review against
   the deployment's regulatory envelope.
3. **Approver roles** — currently admin-only for approve/reject/modify/policy. Confirm whether
   analyst should be allowed to approve low-risk actions.
4. **Tenant isolation** — same open question as `mapper_tasks/INDEX.md` #7 and
   `connector_tasks/10_tenant_isolation_signoff.md`: there is no tenant scoping anywhere in the
   product yet; Autopilot inherits that. Cross-reference, not a new gap introduced here.
5. **Data-driven prompt injection** — mitigated by design decision 2 (no LLM on the decision
   path). If LLM rationale enrichment is ever added, this needs re-review.

Mark `[x]` only when a named human signs off; record who/when here.
