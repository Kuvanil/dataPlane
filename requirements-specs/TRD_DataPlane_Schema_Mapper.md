# Task Requirement Document

> **Note on scope selection:** The task-detail fields in the request were left blank, so this document is scoped to the **Schema Mapper** module — the feature most directly implied by the DataPlane hero copy ("Intelligently map schemas, design visual transformations… safely in regulated environments"). The structure is reusable; any other sidebar module (Connectors, Schema Intel, Query Studio, AskData Bot, Pipelines, AI Autopilot, Security, Audit Trail) can be substituted by swapping Sections 1–7.

---

## 1. Task Overview

- **Task ID:** DP-SM-001
- **Task Name:** Schema Mapper — Visual Source-to-Target Field Mapping with AI-Assisted Suggestions
- **Summary:** Build the Schema Mapper workspace that lets a user visually connect fields from a source schema to a target schema, apply inline transformations, accept or reject AI-generated mapping suggestions, and persist a versioned, auditable mapping definition consumable by the Pipelines and AI Autopilot modules.
- **Business Objective:** Reduce the manual effort and error rate of database migration and integration projects by replacing hand-written mapping spreadsheets/scripts with a guided, AI-assisted visual interface — while preserving the audit and governance guarantees required for regulated environments.

---

## 2. Scope

### In-Scope

- Side-by-side visual canvas rendering a **source schema** and a **target schema** (tables, columns, data types, nullability, keys).
- Drag-to-connect field mapping with a one-to-one and many-to-one relationship model.
- AI-assisted mapping suggestions (name/semantic/type similarity) with confidence scores, surfaced as accept/reject candidates.
- Inline, per-mapping **transformation expressions** (cast, concat, substring, lookup, default value, null-handling).
- Type-compatibility validation between source and target with warnings/blocking errors.
- Mapping definition **save, version, and load** (drafts vs. published versions).
- Export of the mapping definition as a machine-readable artifact (JSON) for the Pipelines module to consume.
- Emission of audit events (create, modify, accept-AI-suggestion, publish) to the Audit Trail module.
- Role-gated access aligned with the active session (e.g., Admin Session shown in the UI).

### Out-of-Scope

- Actual data movement / pipeline execution (owned by **Pipelines** and **AI Autopilot**).
- Source/target connection setup and credential management (owned by **Connectors**).
- Schema discovery/profiling and PII classification (owned by **Schema Intel**).
- Natural-language querying (owned by **AskData Bot** / **Query Studio**).
- Many-to-many (graph) mappings and bidirectional sync.
- Auto-publishing or auto-executing mappings without explicit user confirmation.

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Prioritization, scope sign-off, acceptance |
| Tech Lead / Architect | _TBD_ | Technical design, API contracts, review |
| Frontend Engineer | _TBD_ | Canvas, mapping UI, transformation editor |
| Backend Engineer | _TBD_ | Mapping APIs, validation, versioning, persistence |
| ML/AI Engineer | _TBD_ | Mapping-suggestion service and confidence scoring |
| QA Engineer | _TBD_ | Test plan, acceptance verification |
| Security / Compliance | _TBD_ | Audit-event review, regulated-environment sign-off |
| UX Designer | _TBD_ | Interaction design, accessibility |

---

## 4. Functional Requirements

Requirements are atomic and testable.

- **FR1:** The system shall display the selected source schema and target schema as two panels, each listing tables and their columns with data type, nullability, and key indicators.
- **FR2:** The user shall be able to create a field mapping by dragging a source field onto a target field, rendering a visible connector between them.
- **FR3:** The system shall support one-to-one and many-to-one (multiple sources → one target) mappings and prevent unsupported many-to-many mappings.
- **FR4:** The system shall request AI mapping suggestions for unmapped target fields and display each suggestion with a confidence score (0–100%).
- **FR5:** The user shall be able to **Accept** or **Reject** each AI suggestion; accepting creates a mapping, rejecting dismisses it without side effects.
- **FR6:** The user shall be able to attach a transformation expression to any mapping (e.g., `CAST`, `CONCAT`, `SUBSTRING`, default value, null-handling).
- **FR7:** The system shall validate type compatibility for each mapping and flag incompatibilities as either a warning (lossy cast) or a blocking error (incompatible types) before publish.
- **FR8:** The user shall be able to save the mapping as a **draft** at any time without validation gates.
- **FR9:** The user shall be able to **publish** a mapping only when zero blocking errors exist; publishing creates a new immutable version.
- **FR10:** The system shall expose the published mapping definition as JSON via API for consumption by the Pipelines module.
- **FR11:** The system shall emit an audit event for create, update, AI-suggestion-accept, draft-save, and publish actions, including actor, timestamp, and before/after summary.
- **FR12:** The system shall restrict publish and edit actions according to the user's role/session permissions.

---

## 5. Non-Functional Requirements

- **Performance:** Canvas shall render schemas of up to 50 tables / 1,000 columns within 2 seconds; AI suggestion response shall return within 3 seconds (p95) for a single target table.
- **Security:** All mapping data and transformation expressions encrypted in transit (TLS 1.2+) and at rest; transformation expressions sanitized/validated to prevent injection; no raw source data values are sent to the suggestion service (metadata only).
- **Scalability:** Suggestion service horizontally scalable; mapping storage supports ≥10,000 versioned mapping definitions per tenant.
- **Usability:** Drag-to-connect discoverable without training; clear visual distinction between mapped, unmapped, AI-suggested, and errored fields; keyboard-accessible (WCAG 2.1 AA).
- **Reliability:** Draft autosave every 30 seconds and on blur; no data loss on session timeout; published versions immutable; 99.9% module availability.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| SM-T1 | Define mapping data model & API contract (draft/version/publish) | Backend | — | 3 d |
| SM-T2 | Schema-load endpoint (fetch source/target metadata) | Backend | Connectors API, Schema Intel | 2 d |
| SM-T3 | Dual-panel schema canvas + drag-to-connect UI | Frontend | SM-T1, SM-T2 | 5 d |
| SM-T4 | Transformation expression editor + validation | Frontend/Backend | SM-T3 | 4 d |
| SM-T5 | Type-compatibility validation engine | Backend | SM-T1 | 3 d |
| SM-T6 | AI mapping-suggestion service (similarity + confidence) | ML/AI | SM-T2 | 5 d |
| SM-T7 | Accept/reject suggestion UI + integration | Frontend | SM-T3, SM-T6 | 2 d |
| SM-T8 | Versioning + draft autosave + publish gating | Backend | SM-T1, SM-T5 | 3 d |
| SM-T9 | JSON export endpoint for Pipelines | Backend | SM-T8 | 2 d |
| SM-T10 | Audit-event emission to Audit Trail | Backend | SM-T8, Audit Trail API | 2 d |
| SM-T11 | Role/permission gating | Backend/Frontend | Security module | 2 d |
| SM-T12 | Test suite (unit, integration, E2E) | QA | All above | 4 d |

---

## 7. Acceptance Criteria

**AC1 — Visual mapping creation**
- **Given** a loaded source and target schema
- **When** the user drags a source field onto a compatible target field
- **Then** a connector is drawn and the mapping is recorded in the draft state.

**AC2 — AI suggestion accept**
- **Given** an unmapped target field with an AI suggestion of ≥70% confidence
- **When** the user clicks **Accept**
- **Then** the mapping is created and an `AI_SUGGESTION_ACCEPTED` audit event is emitted with the confidence score.

**AC3 — Type incompatibility blocks publish**
- **Given** a mapping between incompatible data types
- **When** the user attempts to **Publish**
- **Then** publish is blocked and the offending mapping is highlighted with a blocking error message.

**AC4 — Versioned publish**
- **Given** a draft with zero blocking errors
- **When** the user publishes
- **Then** a new immutable version is created and exposed via the JSON export API.

**Checklist**
- [ ] Source and target schemas render with type/key/nullability metadata.
- [ ] One-to-one and many-to-one mappings supported; many-to-many prevented.
- [ ] Transformation expressions can be added, edited, and validated.
- [ ] AI suggestions show confidence scores and are accept/reject-able.
- [ ] Drafts autosave; published versions are immutable.
- [ ] All defined actions emit audit events.
- [ ] Edit/publish gated by role.

---

## 8. Dependencies

**Internal**
- **Connectors** module — source/target connection metadata.
- **Schema Intel** module — schema discovery, profiling, type metadata.
- **Pipelines / AI Autopilot** — consumers of the published mapping JSON.
- **Audit Trail** — sink for emitted audit events.
- **Security** — role/permission definitions and session context.

**External**
- AI/LLM or embedding service backing the suggestion engine.
- Identity provider for session/role context (per "Admin Session" indicator).

---

## 9. Assumptions

- Source and target schemas are already connected and discoverable via the Connectors/Schema Intel modules.
- The suggestion service operates on **schema metadata only** (names, types), not on actual row data, to satisfy regulated-environment constraints.
- A user session carries a resolvable role (e.g., Admin) used for permission gating.
- The Pipelines module accepts a defined JSON mapping contract (agreed in SM-T1).
- Mapping definitions are tenant-scoped and isolated.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Low-quality AI suggestions erode trust | Medium | Surface confidence scores; require explicit accept; allow easy reject; log accept/reject rates for tuning |
| Sending sensitive data to the suggestion service | High | Restrict to metadata only; review payloads in Security sign-off |
| Canvas performance on very large schemas | Medium | Virtualized rendering; pagination/search; lazy-load columns |
| Schema drift after mapping is published | Medium | Validate against current schema on pipeline consumption; flag stale versions |
| Ambiguous transformation expressions cause runtime errors | Medium | Pre-publish expression validation; restricted expression grammar |
| Scope creep into pipeline execution | Medium | Hard boundary: Schema Mapper produces definitions only, never executes |

---

## 11. Technical Notes

- **APIs (proposed):**
  - `GET /api/v1/schemas/{connectionId}` — fetch schema metadata.
  - `POST /api/v1/mappings` — create draft.
  - `PUT /api/v1/mappings/{id}` — update draft.
  - `POST /api/v1/mappings/{id}/suggestions` — request AI suggestions for target fields.
  - `POST /api/v1/mappings/{id}/publish` — validate + version + publish.
  - `GET /api/v1/mappings/{id}/export` — JSON definition for Pipelines.
- **Data model (core entities):** `Mapping`, `MappingVersion`, `FieldMapping` (source ref, target ref, transformation, confidence, origin = manual|ai), `TransformationExpression`, `AuditEvent`.
- **Integrations:** Connectors (read), Schema Intel (read), Pipelines (publish-out), Audit Trail (event-out), Security (permission checks).
- **Constraints:** Regulated-environment posture means metadata-only suggestions, full audit coverage, immutable published versions, and explicit human confirmation before any downstream execution.
- **Transformation grammar:** Restricted, allow-listed function set; no arbitrary code execution; server-side validation.

---

## 12. Definition of Done

- [ ] Code completed and peer-reviewed.
- [ ] Unit and integration tests passing; E2E mapping flow automated.
- [ ] All functional requirements (FR1–FR12) implemented and verified.
- [ ] All acceptance criteria (AC1–AC4 and checklist) met.
- [ ] Audit events validated against the Audit Trail module.
- [ ] Security/compliance sign-off for regulated-environment constraints.
- [ ] API contract documented and shared with the Pipelines team.
- [ ] User-facing and developer documentation updated.

---

### Input Task Details (as used)

- **Task Name:** Schema Mapper — Visual Source-to-Target Field Mapping with AI-Assisted Suggestions
- **Description:** Visual, AI-assisted mapping workspace producing versioned, auditable mapping definitions for downstream pipelines.
- **System/Application:** DataPlane — AI-First Agentic DBA Platform (Schema Mapper module)
- **Priority:** _TBD (suggested: High — core to the product value proposition)_
- **Deadline:** _TBD_
- **Technical Constraints:** Regulated-environment compliance (metadata-only AI, full audit trail, immutable published versions, human-in-the-loop confirmation)
