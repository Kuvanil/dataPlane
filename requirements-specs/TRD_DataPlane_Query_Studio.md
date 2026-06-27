# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-QS-001
- **Task Name:** Query Studio — SQL Authoring & Execution Workspace
- **Summary:** Build the SQL editor workspace where users write, validate, and execute queries against connected sources, view results, save queries, and hand results to Visualize — with guardrails appropriate for regulated environments.
- **Business Objective:** Provide power users a safe, productive query environment inside the platform, reducing the need for external clients and centralizing query governance and audit.

---

## 2. Scope

### In-Scope

- SQL editor with syntax highlighting, autocomplete from the Schema Intel catalog, and formatting.
- Connection/database selector scoping execution context.
- Query execution with paginated, tabular results.
- Read vs. write classification of statements, with write/DDL execution gated by role and explicit confirmation.
- Query history per user and named saved queries.
- "Send to Visualize" handoff of a result set.
- Result export (CSV).
- Audit-event emission for query execution.

### Out-of-Scope

- Natural-language to SQL (owned by AskData Bot).
- Visualization rendering (owned by Visualize).
- Pipeline orchestration (owned by Pipelines).
- Connection/credential management (owned by Connectors).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Guardrail policy |
| Tech Lead | _TBD_ | Execution & safety design |
| Backend Engineer | _TBD_ | Query exec service |
| Frontend Engineer | _TBD_ | Editor + results UI |
| Security | _TBD_ | Write-statement gating sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The editor shall provide SQL syntax highlighting and schema-aware autocomplete sourced from Schema Intel.
- **FR2:** The user shall select an execution context (connection/database) before running a query.
- **FR3:** The system shall execute queries and return results in a paginated table.
- **FR4:** The system shall detect write/DDL statements and require role permission plus explicit user confirmation before execution.
- **FR5:** The system shall maintain per-user query history.
- **FR6:** The user shall be able to save and name queries and reload them.
- **FR7:** The user shall be able to send a result set to Visualize.
- **FR8:** The user shall be able to export results as CSV.
- **FR9:** The system shall emit an audit event for every executed statement (text, actor, context, row count, status).

---

## 5. Non-Functional Requirements

- **Performance:** Editor interactions ≤ 100ms; first result page ≤ 3s (p95) for typical queries; long queries stream/timeout gracefully.
- **Security:** Parameterization where applicable; write/DDL gated; results role-scoped; no credentials in client; statement logging in audit.
- **Scalability:** Result pagination/streaming for large outputs; per-user concurrency limits.
- **Usability:** Clear distinction between read and write statements; obvious confirmation for destructive actions.
- **Reliability:** Query cancellation; safe timeout handling.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| QS-T1 | Query execution service + pagination | Backend | Connectors | 4 d |
| QS-T2 | Statement classifier (read/write/DDL) | Backend | QS-T1 | 2 d |
| QS-T3 | Write-statement gating + confirmation | Backend/Frontend | Security | 2 d |
| QS-T4 | Editor (highlight, autocomplete, format) | Frontend | Schema Intel | 4 d |
| QS-T5 | Results table + export CSV | Frontend | QS-T1 | 3 d |
| QS-T6 | History + saved queries | Backend/Frontend | QS-T1 | 3 d |
| QS-T7 | Send-to-Visualize handoff | Backend/Frontend | Visualize | 2 d |
| QS-T8 | Audit emission | Backend | Audit Trail | 1 d |
| QS-T9 | Tests | QA | All above | 4 d |

---

## 7. Acceptance Criteria

**AC1 — Execute read query**
- **Given** a valid SELECT and chosen context
- **When** the user runs it
- **Then** paginated results render and an audit event is recorded.

**AC2 — Write-statement gating**
- **Given** a user without write permission
- **When** they attempt a DELETE/DROP
- **Then** execution is blocked with a clear permission message.

**AC3 — Schema-aware autocomplete**
- **Given** a connection with a discovered schema
- **When** the user types a table prefix
- **Then** matching tables/columns are suggested.

**Checklist**
- [ ] Highlighting + autocomplete work.
- [ ] Read execution + pagination work.
- [ ] Write/DDL gated + confirmed.
- [ ] History/saved queries persist.
- [ ] Send-to-Visualize works.
- [ ] Audit events emitted.

---

## 8. Dependencies

**Internal:** Connectors (context), Schema Intel (autocomplete), Visualize (handoff), Security (gating), Audit Trail.
**External:** SQL editor component library.

---

## 9. Assumptions

- Execution credentials are governed via Connectors.
- Schema metadata is available for autocomplete.
- Result sets can be paginated/streamed.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Accidental destructive statements | High | Read/write classification + role gating + confirmation |
| Large result sets overwhelm UI | Medium | Pagination/streaming + row caps |
| Query injection via app | High | Parameterization, server-side validation |
| Long-running queries | Medium | Timeouts + cancellation |

---

## 11. Technical Notes

- **APIs:** `POST /query/execute`, `GET /query/history`, `POST /query/saved`, `POST /query/{id}/to-visualize`.
- **Data model:** `Query`, `SavedQuery`, `QueryExecution`, `ResultPage`.
- **Constraints:** Statement-level audit; write gating; role-scoped results.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E tests passing.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on write gating.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
