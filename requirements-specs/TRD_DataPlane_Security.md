# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-SEC-001
- **Task Name:** Security — Access Control, Roles & Data Protection Policy
- **Summary:** Build the security administration workspace that manages users, roles, and permissions (RBAC), defines data-protection policies (PII masking, column/row access), and provides the guardrail definitions consumed by every other module in regulated environments.
- **Business Objective:** Provide centralized, auditable control over who can do what and which data they can see, satisfying compliance requirements and underpinning the platform's "safe in regulated environments" promise.

---

## 2. Scope

### In-Scope

- User and role management (CRUD on roles; assign roles to users).
- Permission model mapping roles to module actions (view/edit/run/publish/delete-gated).
- Data-protection policies: column-level access, PII masking rules, row-level filters.
- Policy enforcement contract exposed to other modules (authorization checks).
- Session/role context surfaced to the app (e.g., "Admin Session" indicator).
- Audit-event emission for all security changes.
- Privileged/destructive security changes gated behind explicit confirmation and elevated role.

### Out-of-Scope

- Identity provider / SSO authentication mechanics (integration point, not built here).
- Secret/credential storage internals (owned by Connectors' vault integration).
- The Audit Trail viewer itself (owned by Audit Trail; Security emits to it).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | RBAC + policy model |
| Tech Lead | _TBD_ | AuthZ architecture |
| Backend Engineer | _TBD_ | RBAC + policy engine |
| Frontend Engineer | _TBD_ | Admin UI |
| Security / Compliance | _TBD_ | Policy correctness sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** An administrator shall create, edit, and deactivate roles.
- **FR2:** An administrator shall assign and revoke roles for users.
- **FR3:** The system shall map roles to permitted module actions (view/edit/run/publish, etc.).
- **FR4:** An administrator shall define column-level access and PII masking policies.
- **FR5:** An administrator shall define row-level access filters.
- **FR6:** The system shall expose an authorization-check contract that other modules call to enforce access.
- **FR7:** The system shall surface the current session's role/identity context to the application.
- **FR8:** Privileged security changes shall require elevated role and explicit confirmation.
- **FR9:** The system shall emit an audit event for every security/policy change (actor, before/after, timestamp).

---

## 5. Non-Functional Requirements

- **Performance:** Authorization checks ≤ 50ms (p95) via cached policy evaluation.
- **Security:** Deny-by-default; least privilege; policy changes audited; protection against privilege escalation; no policy bypass path.
- **Scalability:** Policy engine scales to many roles/users/resources with caching + invalidation.
- **Usability:** Clear role-to-permission matrix; preview of effective permissions for a user.
- **Reliability:** Consistent enforcement across modules; safe failure (deny) on policy-store unavailability.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| SEC-T1 | RBAC data model (users/roles/permissions) | Backend | — | 4 d |
| SEC-T2 | Policy engine + authZ contract | Backend | SEC-T1 | 5 d |
| SEC-T3 | Column/PII masking policies | Backend | SEC-T2, Schema Intel | 4 d |
| SEC-T4 | Row-level access filters | Backend | SEC-T2 | 3 d |
| SEC-T5 | Admin UI (roles, assignments, matrix) | Frontend | SEC-T1 | 5 d |
| SEC-T6 | Effective-permission preview | Frontend/Backend | SEC-T2 | 2 d |
| SEC-T7 | Privileged-change gating | Backend/Frontend | SEC-T1 | 2 d |
| SEC-T8 | Audit emission | Backend | Audit Trail | 1 d |
| SEC-T9 | Tests (incl. authZ bypass attempts) | QA | All above | 5 d |

---

## 7. Acceptance Criteria

**AC1 — Deny by default**
- **Given** a user with no role granting an action
- **When** they attempt that action in any module
- **Then** the authorization check denies it.

**AC2 — PII masking**
- **Given** a column classified as PII and a role without permission to view it
- **When** that user queries the column
- **Then** the value is masked per policy.

**AC3 — Privileged-change gating**
- **Given** a non-elevated user
- **When** they attempt to change role permissions
- **Then** the change is blocked and requires an elevated role + confirmation.

**AC4 — Audited change**
- **Given** an admin edits a role's permissions
- **When** the change is saved
- **Then** an audit event with before/after is emitted.

**Checklist**
- [ ] Role CRUD + assignment works.
- [ ] Role-to-action mapping enforced module-wide.
- [ ] Column/PII masking + row filters enforced.
- [ ] AuthZ contract callable by other modules.
- [ ] Privileged changes gated.
- [ ] All security changes audited.

---

## 8. Dependencies

**Internal:** Schema Intel (PII classifications), Audit Trail (events), all modules (consumers of authZ contract).
**External:** Identity provider / SSO for authentication.

---

## 9. Assumptions

- Authentication is handled by an external IdP; this module governs authorization.
- A defined set of module actions exists to map to permissions.
- PII classifications are available from Schema Intel.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Authorization bypass | Critical | Deny-by-default; centralized contract; bypass-attempt tests |
| Privilege escalation | Critical | Elevated-role gating; full audit; least privilege |
| Stale cached policy | High | Cache invalidation on change; short TTL |
| Misconfigured masking exposing PII | High | Effective-permission preview; default-deny on PII |

---

## 11. Technical Notes

- **APIs:** `POST /roles`, `PUT /roles/{id}`, `POST /users/{id}/roles`, `POST /authz/check`, `PUT /policies/masking`, `PUT /policies/row-access`.
- **Data model:** `User`, `Role`, `Permission`, `MaskingPolicy`, `RowAccessPolicy`.
- **Constraints:** Deny-by-default; centralized enforcement; full audit; no bypass; safe-fail to deny.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E + authZ bypass tests passing.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security/compliance sign-off.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
