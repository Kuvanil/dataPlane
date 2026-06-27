# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-ADB-001
- **Task Name:** AskData Bot — Conversational Natural-Language Data Assistant
- **Summary:** Build the conversational assistant that lets users ask questions about their connected data in natural language; the bot generates SQL grounded in the Schema Intel catalog, executes it safely, and returns answers with the generated query and optional visualization. (Sidebar shows an active/online indicator for this module.)
- **Business Objective:** Lower the barrier to data access for non-SQL users, increasing self-service analytics adoption while keeping execution governed and auditable.

---

## 2. Scope

### In-Scope

- Chat interface with conversation history within a session.
- NL-to-SQL generation grounded in the Schema Intel catalog (schema-aware).
- Read-only execution by default; generated SQL shown to the user for transparency.
- Answer rendering: natural-language summary + result table + optional auto-chart via Visualize.
- "Edit query" handoff to Query Studio.
- Guardrails: block writes/DDL; respect role-scoped data and PII column restrictions.
- Audit-event emission for each NL question, generated SQL, and execution.

### Out-of-Scope

- Free-form write/DDL generation and execution.
- Manual SQL authoring (owned by Query Studio).
- Model training/fine-tuning (separate ML task).
- Connection management (owned by Connectors).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Conversation UX, guardrails |
| Tech Lead | _TBD_ | NL-to-SQL pipeline design |
| ML/AI Engineer | _TBD_ | Prompting/grounding, eval |
| Backend Engineer | _TBD_ | Orchestration + safe execution |
| Frontend Engineer | _TBD_ | Chat UI |
| Security | _TBD_ | PII/role guardrail sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The user shall ask a question in natural language within a chat session.
- **FR2:** The system shall generate SQL grounded in the discovered schema catalog for the selected connection.
- **FR3:** The system shall display the generated SQL alongside the answer for transparency.
- **FR4:** The system shall execute only read statements; any generated write/DDL shall be blocked and surfaced as a limitation.
- **FR5:** The system shall return a natural-language summary plus a result table, with an option to visualize.
- **FR6:** The system shall respect role-scoped data and exclude restricted PII columns from results unless permitted.
- **FR7:** The user shall be able to send the generated query to Query Studio for editing.
- **FR8:** The system shall maintain conversation context for follow-up questions within the session.
- **FR9:** The system shall emit audit events capturing question, generated SQL, and execution outcome.

---

## 5. Non-Functional Requirements

- **Performance:** End-to-end response (generate + execute + summarize) ≤ 6s (p95) for typical questions.
- **Security:** Read-only execution; PII/role guardrails enforced server-side; only metadata (not raw data) used for grounding the model; full audit.
- **Scalability:** Concurrent sessions supported; generation service horizontally scalable.
- **Usability:** Transparent SQL display; clear handling of "I can't answer that" cases; suggested follow-ups.
- **Reliability:** Graceful fallback when generation is low-confidence or ambiguous (ask clarifying question instead of guessing).

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| ADB-T1 | NL-to-SQL generation + grounding | ML/AI | Schema Intel | 6 d |
| ADB-T2 | Read-only validation + guardrails | Backend | Security | 3 d |
| ADB-T3 | Safe execution + summarization | Backend | Query exec (QS-T1) | 4 d |
| ADB-T4 | Chat UI + SQL display | Frontend | — | 4 d |
| ADB-T5 | Conversation context handling | Backend | ADB-T1 | 3 d |
| ADB-T6 | Visualize + Query Studio handoffs | Frontend/Backend | Visualize, Query Studio | 3 d |
| ADB-T7 | Audit emission | Backend | Audit Trail | 1 d |
| ADB-T8 | Eval harness + tests | QA/ML | All above | 5 d |

---

## 7. Acceptance Criteria

**AC1 — NL question to answer**
- **Given** a connection with a discovered schema
- **When** the user asks "How many active customers last month?"
- **Then** the bot generates grounded SQL, executes read-only, and returns a summary + result, with the SQL shown.

**AC2 — Write blocked**
- **Given** a question that would imply a data change
- **When** generation produces a write/DDL statement
- **Then** execution is blocked and the bot explains it is read-only.

**AC3 — PII guardrail**
- **Given** a user not permitted to see a PII column
- **When** the answer would include it
- **Then** that column is excluded or masked per policy.

**AC4 — Ambiguity handling**
- **Given** an ambiguous question
- **When** confidence is low
- **Then** the bot asks a clarifying question rather than guessing.

**Checklist**
- [ ] Grounded SQL generation works.
- [ ] SQL shown to user.
- [ ] Read-only enforced.
- [ ] PII/role guardrails enforced.
- [ ] Visualize/Query Studio handoffs work.
- [ ] Audit events emitted.

---

## 8. Dependencies

**Internal:** Schema Intel (grounding), Query Studio (execution + edit handoff), Visualize (charts), Security (guardrails), Audit Trail.
**External:** LLM/generation service.

---

## 9. Assumptions

- A discovered, classified schema is available for grounding.
- Read-only execution is sufficient for the assistant's purpose.
- The generation service is metadata-grounded, not trained on raw customer data.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Incorrect SQL / wrong answers | High | Schema grounding; show SQL; eval harness; clarifying questions |
| Hallucinated tables/columns | High | Restrict generation to catalog entities; validate before execution |
| PII exposure via NL | High | Server-side role/PII guardrails independent of the model |
| Prompt-injection via data content | Medium | Use metadata only for grounding; never execute instructions from data |

---

## 11. Technical Notes

- **APIs:** `POST /askdata/message` (question + context → answer + sql + results), `POST /askdata/{msgId}/to-query-studio`, `POST /askdata/{msgId}/to-visualize`.
- **Pipeline:** retrieve catalog → generate SQL → validate (read-only, catalog-only, role/PII) → execute → summarize.
- **Constraints:** Read-only; catalog-grounded; full audit; guardrails enforced outside the model.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E tests passing; eval harness baseline met.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on guardrails.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
