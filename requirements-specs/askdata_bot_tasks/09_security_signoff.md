# Task #9 — Security sign-off (ADB-T9)

**TRD reference:** Security NFR (§5), §12 DoD.

**Current state:** No security review has been conducted for the AskData module. The existing codebase has no holistic security review covering the NL-to-SQL pipeline's specific risks.

## Scope

Security review and sign-off for the AskData module, covering the unique risks of an NL-to-SQL system: prompt injection, PII exposure via NL, unauthorized data access, and write-statement injection.

### Review areas

1. **Read-only enforcement** — Verify that no code path can execute a write/DDL statement. Confirm the guardrails (task #2) are comprehensive and cannot be bypassed.

2. **PII/role guardrails** — Verify that PII column filtering works correctly for all query patterns (SELECT *, explicit column lists, subqueries, JOINs). Verify role-scoping is enforced server-side.

3. **Prompt injection** — Verify that:
   - Only metadata (not raw data) is used for LLM grounding.
   - No instructions embedded in schema metadata can influence the model.
   - User input is sanitized/truncated before being included in prompts.
   - The LLM output is parsed and validated (not blindly executed).

4. **Catalog grounding fidelity** — Verify generated SQL only references entities that exist in the catalog. No hallucinated tables/columns can be executed.

5. **Audit completeness** — Verify all required audit events are emitted with correct data and correlation IDs.

6. **Data at rest** — Verify chat messages and session data don't store sensitive information beyond what's necessary.

### Deliverables

- Security review report.
- Sign-off checklist with items, findings, and remediation status.
- Any code changes required to address findings.

### Dependencies

- Tasks #1, #2, #3, #7, #8 must be complete (the code to review must exist).
- Security/compliance team availability.

## Verify

- All review areas are documented with pass/fail status.
- Any findings have been remediated or accepted with documented risk.
- Security sign-off checklist is complete and signed.