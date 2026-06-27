# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-CONN-001
- **Task Name:** Connectors — Source & Target Connection Management
- **Summary:** Build the workspace to create, test, manage, and monitor connections to databases and data sources/targets, including secure credential handling, connection testing, and schema discovery handoff to Schema Intel.
- **Business Objective:** Provide a secure, governed foundation for all data operations by centralizing how DataPlane connects to systems, ensuring credentials are never exposed and connections are auditable.

---

## 2. Scope

### In-Scope

- Catalog of supported connector types (relational DBs, warehouses, object stores).
- Create/edit/delete (soft-delete) connection configurations.
- Secure credential capture via a vault/secret manager (never stored in plaintext, never displayed after entry).
- "Test Connection" action with clear success/failure diagnostics.
- Connection health status indicator (healthy / degraded / down).
- Schema discovery trigger that hands metadata to Schema Intel.
- Audit-event emission for create/edit/delete/test actions.
- Role-gated access to connection management.

### Out-of-Scope

- Actual schema profiling/classification (owned by Schema Intel).
- Field mapping (owned by Schema Mapper).
- Data movement (owned by Pipelines).
- Building new connector driver types (treated as separate engineering tasks).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Connector catalog priorities |
| Tech Lead | _TBD_ | Driver abstraction, secret design |
| Backend Engineer | _TBD_ | Connection APIs, test logic |
| Frontend Engineer | _TBD_ | Connector UI, forms |
| Security | _TBD_ | Credential handling sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The system shall list available connector types with metadata (name, category, required fields).
- **FR2:** The user shall be able to create a connection by selecting a type and supplying connection parameters.
- **FR3:** Credentials shall be submitted to a secret manager and never returned to the client after save.
- **FR4:** The user shall be able to run "Test Connection," receiving a clear pass/fail result with diagnostic detail on failure.
- **FR5:** The system shall display a live health status for each saved connection.
- **FR6:** The user shall be able to edit non-secret fields and rotate credentials without exposing existing secret values.
- **FR7:** The user shall be able to soft-delete a connection; dependent mappings/pipelines shall be flagged, not silently broken.
- **FR8:** The system shall trigger schema discovery (handoff to Schema Intel) on demand.
- **FR9:** The system shall emit audit events for all create/edit/delete/test/rotate actions.

---

## 5. Non-Functional Requirements

- **Performance:** Test Connection result returned ≤ 5s (p95) or times out with a clear message.
- **Security:** Secrets stored only in the vault; TLS for all connection traffic; least-privilege credentials encouraged; no secret in logs/URLs.
- **Scalability:** Support hundreds of connections per tenant.
- **Usability:** Dynamic forms per connector type; inline validation; clear error diagnostics.
- **Reliability:** Health checks resilient to transient failures with retry/backoff.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| CONN-T1 | Connection data model + driver abstraction | Backend | — | 4 d |
| CONN-T2 | Secret-manager integration | Backend | Security | 3 d |
| CONN-T3 | Test Connection + diagnostics | Backend | CONN-T1 | 3 d |
| CONN-T4 | Health-check scheduler | Backend | CONN-T1 | 2 d |
| CONN-T5 | Connector catalog + dynamic forms UI | Frontend | CONN-T1 | 4 d |
| CONN-T6 | Discovery handoff to Schema Intel | Backend | Schema Intel API | 2 d |
| CONN-T7 | Dependency-aware soft delete | Backend | Schema Mapper/Pipelines | 2 d |
| CONN-T8 | Audit emission | Backend | Audit Trail | 1 d |
| CONN-T9 | Tests | QA | All above | 3 d |

---

## 7. Acceptance Criteria

**AC1 — Secure credential capture**
- **Given** a user creates a connection with credentials
- **When** the connection is saved
- **Then** the credential is stored in the secret manager and is never returned or displayed thereafter.

**AC2 — Test connection failure diagnostics**
- **Given** invalid connection parameters
- **When** the user runs Test Connection
- **Then** a failure result with a human-readable diagnostic reason is shown.

**AC3 — Dependency-aware delete**
- **Given** a connection used by an active mapping
- **When** the user soft-deletes it
- **Then** the dependent mapping is flagged and the user is warned before confirmation.

**Checklist**
- [ ] Connector catalog renders with dynamic forms.
- [ ] Test Connection works for pass and fail paths.
- [ ] Health status updates.
- [ ] Schema discovery handoff functions.
- [ ] Audit events emitted.

---

## 8. Dependencies

**Internal:** Security (secret manager, roles), Schema Intel (discovery), Schema Mapper & Pipelines (dependency checks), Audit Trail.
**External:** Database/driver libraries, secret vault service.

---

## 9. Assumptions

- A secret manager/vault is available to the platform.
- Network egress to target systems is permitted from the platform's environment.
- Connector driver types in scope already exist.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Credential leakage | High | Vault-only storage; redact logs; no secrets in client responses |
| Long-hanging test connections | Medium | Strict timeouts + async health checks |
| Silent breakage of dependents on delete | High | Dependency graph + soft delete + warnings |
| Connector misconfiguration | Medium | Inline validation + clear diagnostics |

---

## 11. Technical Notes

- **APIs:** `GET /connectors/types`, `POST /connectors`, `PUT /connectors/{id}`, `POST /connectors/{id}/test`, `POST /connectors/{id}/discover`, `DELETE /connectors/{id}`.
- **Data model:** `Connector`, `ConnectionConfig` (non-secret), `SecretRef`, `HealthStatus`.
- **Constraints:** Regulated environment — secrets vaulted, full audit, least-privilege.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E tests passing.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on credential handling.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
