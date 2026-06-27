# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-DASH-001
- **Task Name:** Dashboard — Unified Operational Overview
- **Summary:** Build the default landing workspace that gives an authenticated user a consolidated, at-a-glance view of platform health, connector status, recent activity, pipeline runs, and AI Autopilot actions, with drill-through into each module.
- **Business Objective:** Reduce time-to-insight for operators by surfacing the most decision-relevant signals in one screen, lowering context-switching and accelerating detection of failures or anomalies.

---

## 2. Scope

### In-Scope

- Summary KPI tiles (active connectors, pipelines running/failed, queries today, open security alerts).
- Recent activity feed (pipeline runs, mapping publishes, AI Autopilot actions) sourced from Audit Trail.
- Connector health widget with status (healthy / degraded / down).
- AI Autopilot activity widget (recent autonomous actions + outcomes).
- Time-range filter (24h / 7d / 30d) applied to widgets.
- Drill-through navigation from any widget to its owning module.
- Empty/error/loading states for every widget.

### Out-of-Scope

- Custom dashboard builder / draggable widgets (future enhancement).
- Editing or executing actions directly from the dashboard (read-only surface).
- Detailed module data (owned by each respective module).

---

## 3. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Tile selection, acceptance |
| Tech Lead | _TBD_ | Aggregation API design |
| Frontend Engineer | _TBD_ | Widget layout, states |
| Backend Engineer | _TBD_ | Aggregation/summary endpoints |
| QA Engineer | _TBD_ | Verification |
| UX Designer | _TBD_ | Information hierarchy |

---

## 4. Functional Requirements

- **FR1:** The system shall render the Dashboard as the default route after authentication.
- **FR2:** The system shall display KPI tiles for active connectors, running pipelines, failed pipelines, queries executed, and open security alerts.
- **FR3:** The system shall display a recent activity feed of the latest N events across modules in reverse-chronological order.
- **FR4:** The system shall allow the user to filter all time-sensitive widgets by 24h, 7d, or 30d.
- **FR5:** Each KPI tile and feed item shall link to the relevant module/detail view.
- **FR6:** The system shall display distinct loading, empty, and error states per widget without failing the whole page.
- **FR7:** Dashboard data shall reflect only resources the user's role is permitted to view.

---

## 5. Non-Functional Requirements

- **Performance:** Initial dashboard render ≤ 2.5s (p95); widget data refresh ≤ 1.5s.
- **Security:** All aggregated data role-scoped; no sensitive values exposed in tiles.
- **Scalability:** Aggregation endpoints cached and able to serve dashboards for tenants with thousands of resources.
- **Usability:** Responsive layout; clear visual priority; accessible (WCAG 2.1 AA).
- **Reliability:** Individual widget failure is isolated; auto-retry on transient errors.

---

## 6. Task Breakdown / Subtasks

| Subtask ID | Description | Owner | Dependencies | Estimate |
|------------|-------------|--------|---------------|----------|
| DASH-T1 | Aggregation API (KPIs + feed) | Backend | All module APIs | 4 d |
| DASH-T2 | Caching layer for summaries | Backend | DASH-T1 | 2 d |
| DASH-T3 | Widget framework + states | Frontend | — | 3 d |
| DASH-T4 | KPI tiles + drill-through | Frontend | DASH-T1, DASH-T3 | 3 d |
| DASH-T5 | Activity feed widget | Frontend | DASH-T1, Audit Trail | 2 d |
| DASH-T6 | Time-range filter | Frontend | DASH-T4 | 1 d |
| DASH-T7 | Role-scoping | Backend | Security | 2 d |
| DASH-T8 | Tests | QA | All above | 3 d |

---

## 7. Acceptance Criteria

**AC1 — Default landing**
- **Given** a successfully authenticated user
- **When** they log in
- **Then** the Dashboard route loads as the default view.

**AC2 — Time-range filter**
- **Given** the Dashboard is loaded
- **When** the user selects "7d"
- **Then** all time-sensitive widgets re-query and reflect the last 7 days.

**AC3 — Widget isolation**
- **Given** one widget's data source is unavailable
- **When** the page loads
- **Then** that widget shows an error state while all other widgets render normally.

**Checklist**
- [ ] KPI tiles render with correct counts.
- [ ] Activity feed is reverse-chronological and links through.
- [ ] Role-scoped data only.
- [ ] Loading/empty/error states present.

---

## 8. Dependencies

**Internal:** Connectors, Pipelines, AI Autopilot, Security, Query Studio, Audit Trail, Schema Mapper APIs.
**External:** Identity provider for session context.

---

## 9. Assumptions

- Each module exposes a lightweight summary/count endpoint.
- Audit Trail is the canonical source for the activity feed.
- Dashboard is read-only.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Slow load from many module calls | High | Server-side aggregation + caching |
| Stale cached counts | Medium | Short TTL + manual refresh control |
| Inconsistent data across widgets | Medium | Single aggregation timestamp shown |

---

## 11. Technical Notes

- **API:** `GET /api/v1/dashboard/summary?range=7d` returning KPIs + feed in one payload.
- **Caching:** Per-tenant cache keyed by range with short TTL.
- **Integrations:** Reads only; consumes summary endpoints from all modules.

---

## 12. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration/E2E tests passing.
- [ ] FR1–FR7 implemented and verified.
- [ ] Acceptance criteria met.
- [ ] Documentation updated.
