# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-AUTO-001
- **Task Name:** AI Autopilot — Autonomous, Policy-Governed Data Operations
- **Summary:** Build the agentic layer that proposes and (within strict, user-defined policy and approval boundaries) executes data-engineering actions — such as recommending mappings, triggering pipeline runs, and remediating failures — with human-in-the-loop controls and full auditability for regulated environments.
- **Business Objective:** Reduce manual operational toil and mean-time-to-resolution by safely automating routine data-engineering decisions, while preserving governance, explainability, and human oversight.

---

## 2. Scope

### In-Scope

- Autopilot policy configuration: which action types are allowed, autonomy level (suggest-only / approve-then-act / auto-act within limits), and guardrail limits.
- Recommendation engine producing actionable suggestions (e.g., proposed mapping, pipeline run, retry, drift remediation) with rationale and confidence.
- Human-in-the-loop approval queue for actions above the autonomy threshold.
- Bounded autonomous execution for explicitly allow-listed, low-risk actions only.
- Action log with rationale, inputs, outcome, and reversibility notes.
- Hard prohibitions: no destructive/irreversible actions autonomously; no permission/security changes autonomously.
- Audit-event emission for every recommendation, approval, and execution.

### Out-of-Scope

- Defining mappings (Schema Mapper) or pipelines (Pipelines) from scratch by hand — Autopilot orchestrates these, it does not replace their authoring surfaces.
- Autonomous changes to access controls, security settings, or credentials (always prohibited).
- Fully unsupervised execution outside configured policy.

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Autonomy policy model |
| Tech Lead | _TBD_ | Agent architecture, guardrails |
| ML/AI Engineer | _TBD_ | Recommendation/decision logic |
| Backend Engineer | _TBD_ | Orchestration, approval flow |
| Frontend Engineer | _TBD_ | Policy + approval UI |
| Security / Compliance | _TBD_ | Guardrail and audit sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The user shall configure an autonomy policy specifying allowed action types and autonomy level per type.
- **FR2:** The system shall generate recommendations with a human-readable rationale and confidence score.
- **FR3:** Actions above the configured autonomy threshold shall be routed to an approval queue and require explicit human approval before execution.
- **FR4:** The system shall autonomously execute only allow-listed, reversible, low-risk actions within configured limits.
- **FR5:** The system shall never autonomously perform destructive/irreversible actions or modify security/access settings.
- **FR6:** The system shall log every recommendation, decision, approval, and execution with rationale and outcome.
- **FR7:** The user shall be able to approve, reject, or modify a recommended action from the queue.
- **FR8:** The system shall enforce per-type and global rate/volume limits on autonomous actions.
- **FR9:** The system shall emit audit events for all Autopilot activity.

---

## 5. Non-Functional Requirements

- **Performance:** Recommendation generated ≤ 10s after a triggering event; approval actions applied ≤ 5s.
- **Security:** Strict allow-list enforced server-side; prohibited actions hard-blocked regardless of policy/config; full audit; least-privilege service identity.
- **Scalability:** Event-driven; able to evaluate many triggers concurrently.
- **Usability:** Clear rationale and reversibility info per action; obvious approve/reject controls.
- **Reliability:** Fail-safe defaults to suggest-only on uncertainty; idempotent action application.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| AUTO-T1 | Autonomy policy model + config UI | Backend/Frontend | Security | 4 d |
| AUTO-T2 | Recommendation engine + rationale | ML/AI | Pipelines, Schema Intel | 6 d |
| AUTO-T3 | Guardrail/allow-list enforcement | Backend | Security | 4 d |
| AUTO-T4 | Approval queue + actions | Backend/Frontend | AUTO-T2 | 4 d |
| AUTO-T5 | Bounded autonomous executor | Backend | AUTO-T3, Pipelines | 4 d |
| AUTO-T6 | Action log + reversibility notes | Backend | AUTO-T2 | 2 d |
| AUTO-T7 | Rate/volume limiting | Backend | AUTO-T5 | 2 d |
| AUTO-T8 | Audit emission | Backend | Audit Trail | 1 d |
| AUTO-T9 | Tests (incl. safety/guardrail) | QA | All above | 6 d |

---

## 7. Acceptance Criteria

**AC1 — Suggest-only policy**
- **Given** an action type set to "suggest-only"
- **When** Autopilot generates a recommendation for it
- **Then** it appears as a suggestion and is never executed without approval.

**AC2 — Approval gate**
- **Given** an action above the autonomy threshold
- **When** Autopilot proposes it
- **Then** it enters the approval queue and only executes after explicit human approval.

**AC3 — Prohibited action hard-block**
- **Given** any policy configuration
- **When** Autopilot would change access controls or perform an irreversible delete
- **Then** the action is hard-blocked and surfaced as not permitted, regardless of config.

**AC4 — Bounded autonomous execution**
- **Given** an allow-listed, reversible action within limits
- **When** the triggering condition occurs
- **Then** Autopilot executes it and logs rationale + outcome.

**Checklist**
- [ ] Policy configurable per action type.
- [ ] Recommendations include rationale + confidence.
- [ ] Approval queue enforced.
- [ ] Prohibited actions hard-blocked server-side.
- [ ] Rate/volume limits enforced.
- [ ] Full audit of all activity.

---

## 8. Dependencies

**Internal:** Pipelines (execution), Schema Mapper/Schema Intel (inputs), Security (guardrails, policy), Audit Trail.
**External:** Decision/LLM service for recommendations.

---

## 9. Assumptions

- A clear taxonomy of action risk levels and reversibility exists.
- Prohibited-action list is defined and enforced independently of user config.
- Human approvers are designated by role.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unsafe autonomous action | Critical | Server-side allow-list; hard-blocked prohibited set; fail-safe to suggest-only |
| Over-trust in recommendations | High | Mandatory rationale + confidence + human approval above threshold |
| Runaway automated volume | High | Rate/volume limits + circuit breaker |
| Prompt-injection from data driving actions | High | Decisions grounded in metadata/state, never on instructions embedded in data |
| Lack of explainability | Medium | Persistent action log with rationale and reversibility |

---

## 11. Technical Notes

- **APIs:** `PUT /autopilot/policy`, `GET /autopilot/recommendations`, `POST /autopilot/recommendations/{id}/approve|reject`, `GET /autopilot/actions`.
- **Data model:** `AutonomyPolicy`, `Recommendation`, `ApprovalRequest`, `AutopilotAction`.
- **Constraints:** Prohibited actions (access-control changes, irreversible deletes, security/credential changes) are blocked at the service layer irrespective of configuration; everything audited; human-in-the-loop default.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E + dedicated safety/guardrail tests passing.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security/compliance sign-off on guardrails and prohibited-action enforcement.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
