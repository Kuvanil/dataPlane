# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-SI-001
- **Task Name:** Schema Intel — Automated Schema Discovery, Profiling & Classification
- **Summary:** Build the intelligence layer that discovers schema structure from connected sources, profiles data characteristics (types, cardinality, null rates, sample distributions), and classifies sensitive data (e.g., PII) to inform mapping, querying, and governance.
- **Business Objective:** Give users an accurate, automatically maintained understanding of their data estate, reducing manual cataloging effort and surfacing compliance-relevant attributes before data is moved or shared.

---

## 2. Scope

### In-Scope

- Schema discovery from a connection (tables, columns, types, keys, relationships).
- Data profiling per column: null rate, distinct count/cardinality, min/max, sample values.
- Sensitive-data classification (PII categories such as email, phone, name, ID) with confidence.
- Searchable schema catalog with filtering by table/column/classification.
- Re-scan / refresh with schema-drift detection (added/removed/changed columns).
- Profiling on metadata + bounded samples only (regulated-environment safe).
- Audit-event emission for scans and classification changes.

### Out-of-Scope

- Establishing the connection (owned by Connectors).
- Field-level mapping (owned by Schema Mapper).
- Enforcement/masking policy execution (owned by Security).
- NL querying (owned by AskData Bot).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Classification taxonomy |
| Tech Lead | _TBD_ | Profiling architecture |
| ML/AI Engineer | _TBD_ | Classification models |
| Backend Engineer | _TBD_ | Discovery + profiling jobs |
| Frontend Engineer | _TBD_ | Catalog UI |
| Security | _TBD_ | PII handling sign-off |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The system shall discover and persist schema structure (tables, columns, types, keys) from a connection.
- **FR2:** The system shall profile each column for null rate, distinct count, and min/max where applicable.
- **FR3:** The system shall classify columns into sensitive-data categories with a confidence score.
- **FR4:** The user shall be able to search and filter the catalog by table, column, type, and classification.
- **FR5:** The user shall be able to manually override an automated classification, with the override audited.
- **FR6:** The system shall support re-scan and detect schema drift, highlighting added/removed/changed elements.
- **FR7:** Profiling shall operate on bounded samples and metadata only; configurable sample limits shall be enforced.
- **FR8:** The system shall emit audit events for scans, classifications, and overrides.

---

## 5. Non-Functional Requirements

- **Performance:** Profiling of a 100-column table completes ≤ 60s for bounded samples; UI catalog search ≤ 1s.
- **Security:** Sample data minimized and not persisted beyond profiling; classifications encrypted at rest; least-privilege scan credentials.
- **Scalability:** Asynchronous, queued scan jobs scaling across many tables.
- **Usability:** Clear classification badges and confidence; easy drift review.
- **Reliability:** Idempotent re-scans; partial-failure tolerance per table.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| SI-T1 | Discovery engine (structure) | Backend | Connectors | 4 d |
| SI-T2 | Profiling jobs (async/queued) | Backend | SI-T1 | 4 d |
| SI-T3 | Classification service + confidence | ML/AI | SI-T2 | 5 d |
| SI-T4 | Catalog store + search | Backend | SI-T1 | 3 d |
| SI-T5 | Catalog UI + classification badges | Frontend | SI-T4 | 4 d |
| SI-T6 | Drift detection on re-scan | Backend | SI-T1 | 3 d |
| SI-T7 | Manual override + audit | Backend/Frontend | SI-T3, Audit Trail | 2 d |
| SI-T8 | Tests | QA | All above | 4 d |

---

## 7. Acceptance Criteria

**AC1 — Discovery**
- **Given** a healthy connection
- **When** the user triggers a scan
- **Then** the schema structure is discovered and appears in the catalog.

**AC2 — PII classification**
- **Given** a column containing email-formatted values
- **When** profiling/classification runs
- **Then** it is classified as "Email (PII)" with a confidence score.

**AC3 — Drift detection**
- **Given** a previously scanned schema
- **When** a column is added at source and a re-scan runs
- **Then** the new column is flagged as added in the drift view.

**Checklist**
- [ ] Structure discovered and persisted.
- [ ] Profiling metrics computed.
- [ ] Classifications with confidence shown.
- [ ] Override works and is audited.
- [ ] Sample limits enforced.

---

## 8. Dependencies

**Internal:** Connectors (access), Security (PII policy), Schema Mapper & AskData Bot (consumers), Audit Trail.
**External:** Classification model/embedding service.

---

## 9. Assumptions

- Scan credentials have read access to metadata and sample rows.
- A classification taxonomy is defined and approved.
- Bounded sampling is acceptable for accuracy needs.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mis-classification of PII | High | Confidence thresholds + manual override + audit |
| Sample data leakage | High | Minimize, do not persist samples; metadata-first |
| Long scans on large schemas | Medium | Async queued jobs + bounded sampling |
| Stale catalog after drift | Medium | Scheduled re-scan + drift flags |

---

## 11. Technical Notes

- **APIs:** `POST /connections/{id}/scan`, `GET /catalog`, `PATCH /catalog/columns/{id}/classification`.
- **Data model:** `SchemaObject`, `ColumnProfile`, `Classification`, `DriftEvent`.
- **Constraints:** Metadata + bounded-sample profiling; no long-term sample retention; full audit.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E tests passing.
- [ ] FR1–FR8 implemented and verified.
- [ ] Security sign-off on PII handling.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
