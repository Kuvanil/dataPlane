# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-SEM-001
- **Task Name:** Semantic / Metrics Layer — Canonical Definitions for Entities & Metrics
- **Summary:** Build the governed semantic layer where business entities, dimensions, and metrics (e.g., "active customer," "monthly revenue") are defined once, versioned, and reused consistently across Visualize and AskData Bot — so the same term always resolves to the same underlying logic.
- **Business Objective:** Eliminate metric inconsistency ("whose revenue number is right?") and materially improve AskData Bot accuracy by grounding natural-language questions in curated, approved definitions rather than ad-hoc SQL.

---

## 2. Scope

### In-Scope

- Definition of semantic entities, dimensions, and measures/metrics mapped to physical schema (via Schema Intel catalog).
- Metric logic: aggregation, filters, joins, and time-grain, expressed in a governed definition (not free SQL).
- Versioning and governed publish (drafts vs. published; changes reviewable via Collaboration).
- Metric catalog: searchable, with business descriptions, ownership, and lineage to source columns.
- Query resolution API: given a metric + dimensions + filters, produce the correct query/result for consumers.
- Consumption by Visualize (build charts from metrics) and AskData Bot (ground NL answers in metrics).
- Certified/verified badges to distinguish approved metrics from experimental ones.
- Audit of metric definition changes and publishes.

### Out-of-Scope

- Physical schema discovery (owned by Schema Intel).
- Chart rendering (owned by Visualize) and NL generation (owned by AskData Bot) — this layer provides definitions/resolution.
- Arbitrary SQL authoring (owned by Query Studio).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Semantic model, governance |
| Analytics Eng / SME | _TBD_ | Metric correctness, ownership |
| Tech Lead | _TBD_ | Definition language + resolution engine |
| Backend Engineer | _TBD_ | Semantic store, query resolution |
| Frontend Engineer | _TBD_ | Metric editor + catalog UI |
| QA Engineer | _TBD_ | Verification |

---

## 4. Functional Requirements

- **FR1:** The user shall define entities, dimensions, and measures mapped to physical schema objects from the Schema Intel catalog.
- **FR2:** The user shall express metric logic (aggregation, filters, joins, time-grain) via a governed definition rather than free-form SQL.
- **FR3:** The system shall version definitions and support a governed publish (draft → published), reviewable via Collaboration.
- **FR4:** The system shall provide a searchable metric catalog with descriptions, ownership, and lineage to source columns.
- **FR5:** The system shall provide a resolution API that, given a metric with dimensions/filters, returns the correct query/result.
- **FR6:** Visualize shall be able to build visualizations directly from published metrics.
- **FR7:** AskData Bot shall be able to resolve natural-language questions against published metrics for grounded, consistent answers.
- **FR8:** The system shall mark metrics as certified/experimental and expose this to consumers.
- **FR9:** The system shall audit definition changes and publishes.

---

## 5. Non-Functional Requirements

- **Performance:** Metric resolution to query ≤ 500ms; catalog search ≤ 1s.
- **Security:** Definitions respect Security column/row policies; resolution enforces role-scoped access; no bypass of masking.
- **Scalability:** Hundreds of metrics/entities per tenant with efficient resolution and caching.
- **Usability:** Clear, no-SQL metric editor; certified badges; visible lineage.
- **Reliability:** Deterministic resolution; published definitions immutable per version.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| SEM-T1 | Semantic definition model + language | Backend | Schema Intel | 5 d |
| SEM-T2 | Physical-schema mapping + lineage | Backend | Schema Intel | 4 d |
| SEM-T3 | Query resolution engine | Backend | SEM-T1 | 6 d |
| SEM-T4 | Versioning + governed publish | Backend | SEM-T1, Collaboration | 3 d |
| SEM-T5 | Metric catalog + search + certified badges | Backend/Frontend | SEM-T2 | 4 d |
| SEM-T6 | Metric editor UI (no-SQL) | Frontend | SEM-T1 | 5 d |
| SEM-T7 | Visualize + AskData Bot integration | Backend | Visualize, AskData Bot | 4 d |
| SEM-T8 | Policy enforcement in resolution | Backend | Security | 3 d |
| SEM-T9 | Audit emission | Backend | Audit Trail | 1 d |
| SEM-T10 | Tests (incl. resolution correctness) | QA | All above | 5 d |

---

## 7. Acceptance Criteria

**AC1 — Define + publish metric**
- **Given** a mapped measure and dimensions
- **When** a user defines "monthly revenue" and publishes it
- **Then** it becomes a versioned, published metric in the catalog with lineage.

**AC2 — Consistent resolution**
- **Given** a published metric
- **When** it is used in both Visualize and AskData Bot
- **Then** both return the same value for the same dimensions/filters.

**AC3 — Policy-respecting resolution**
- **Given** a user restricted from a source column
- **When** a metric derived from it is resolved
- **Then** masking/row policies are enforced (no bypass).

**AC4 — Certified badge**
- **Given** an experimental vs. certified metric
- **When** a consumer views them
- **Then** the certification status is clearly shown.

**Checklist**
- [ ] Entities/dimensions/measures definable and mapped.
- [ ] Metric logic without free SQL.
- [ ] Versioning + governed publish + review.
- [ ] Catalog with lineage + certified badges.
- [ ] Resolution API correct + consistent across consumers.
- [ ] Security policies enforced in resolution.
- [ ] Changes audited.

---

## 8. Dependencies

**Internal:** Schema Intel (physical schema/lineage), Security (policy enforcement), Visualize & AskData Bot (consumers), Collaboration (review of definition changes), Audit Trail.
**External:** None core (optional dbt/semantic-standard interop later).

---

## 9. Assumptions

- Schema Intel catalog provides reliable physical schema and lineage anchors.
- A no-SQL definition language is sufficient for target metrics.
- Consumers (Visualize, AskData Bot) will adopt the resolution API.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Incorrect metric logic propagates everywhere | High | Review workflow + certified badges + resolution tests |
| Policy bypass via semantic layer | High | Enforce Security policies inside resolution |
| Definition drift from physical schema | Medium | Lineage + drift alerts from Schema Intel |
| Low consumer adoption | Medium | Tight Visualize/AskData integration + clear value (accuracy) |

---

## 11. Technical Notes

- **APIs:** `POST /semantic/metrics`, `POST /semantic/metrics/{id}/publish`, `GET /semantic/catalog`, `POST /semantic/resolve` (metric + dims + filters → query/result).
- **Data model:** `Entity`, `Dimension`, `Measure`, `MetricDefinition` (version, certified), `Lineage`.
- **Constraints:** Governed definitions (no free SQL); role/masking enforced in resolution; immutable published versions; full audit.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E + resolution-correctness tests passing.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on policy enforcement in resolution.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.