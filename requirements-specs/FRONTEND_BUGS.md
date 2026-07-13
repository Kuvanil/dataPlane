# Frontend — Missing Features & Implementation Bugs

> Validated against all TRD documents and the frontend source tree as of commit `34fb9e05`.
> Each bug references the specific TRD Functional Requirements (FR) that are not met.

---

## Bug Summary

| # | Epic | Page Route | Severity | Title |
|---|------|-----------|----------|-------|
| 01 | Visualize | `/dashboard/visualize` | **Critical** | ✅ Fixed (2026-07-13) — real charting workspace built; topology graph moved to `/dashboard/visualize/topology` |
| 02 | Visualize | `/dashboard/visualize` | **High** | ✅ Fixed (2026-07-13) — chart types, field config, aggregations, save/load views, CSV/PNG export all landed |
| 03 | Schema Intel | `/dashboard/schema` | **High** | ✅ Fixed (2026-07-13) — Schema Matcher replaced with a real catalog: search/filter, profiling, classification+confidence, manual override, drift history |
| 04 | Security | `/dashboard/security` | **High** | ✅ Fixed (2026-07-13) — full RBAC + masking/row-filter admin page built (`security_tasks/INDEX.md`) |
| 05 | Pipelines | `/dashboard/pipelines` | **High** | ✅ Fixed (2026-07-13) — create form (from published mapping), cron scheduler, run history, re-run, retry policy, concurrency guard all landed and verified with real data movement |
| 06 | Connectors | `/dashboard/connectors` | **High** | ✅ Fixed — Edit, soft-delete with dependency warnings, credential rotation, and audit log added |
| 07 | AskData Bot | `/dashboard/askdata` | **Medium** | Missing Visualize handoff, no conversation persistence across reloads, no PII guardrail indicators |
| 08 | Audit Trail | `/dashboard/audit` | **Medium** | Missing retention policy display, no tamper-evidence verification UI, no role-gating indicators |
| 09 | AI Autopilot | `/dashboard/autopilot` | **Medium** | No policy configuration UI, no rate/volume limits, no hard prohibition indicators |
| 10 | Query Studio | `/dashboard/query-studio` | **Medium** | No schema-aware autocomplete, write/DDL confirmation, send-to-Visualize, or CSV export |
| 11 | Dashboard | `/dashboard` | **Medium** | Missing connector health widget, autopilot activity widget, security alert tile, drill-through |
| 12 | Schema Mapper | `/dashboard/schema-mapper` | **Medium** | AI suggestion accept/reject UI absent, no type-compatibility validation display, no publish flow |
| 13 | Tenant Isolation | *(missing)* | **High** | ADR resolved 2026-07-13; a build attempt the same day was aborted at design stage — real scope is ~3-4x the original 12-task estimate (39 tables not 24, new DB role needed for RLS, Celery rework). Re-scoped as a phased, multi-session epic — see `tenant_isolation_tasks/00_architecture_decision.md` §9–§10 |
| 14 | Pages Inline Architecture | Multiple | **Low** | Connectors, pipelines, schema, security, visualize all have logic inline — no component separation — violates maintainability best practices |

---

## Bug Details

### Bug 01 — [Critical] Visualize page is a Topology Graph, not a Charting Tool

**Page:** `/dashboard/visualize`
**TRD:** `TRD_DataPlane_Visualize.md`
**FRs violated:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8 (all 8)

**Description:**
The Visualize page renders a Database Topology Graph (ReactFlow-based graph showing source/target table relationships with risk annotations). This is an entirely different feature from the Visualization workspace specified in the TRD. The TRD mandates:
- Chart types: table, bar, line, area, pie, scatter, KPI/single-value (FR2)
- Field configuration with dimensions, measures, aggregations (FR3)
- Interactive filters and sorting (FR4)
- Save/load named views (FR6)
- Export chart as PNG and data as CSV (FR7)

None of these exist. The current page is useful as a schema topology explorer but should be renamed/moved, and a proper Visualize page must be built.

**Impact:** Users cannot build charts, explore data visually, or create dashboards from query results. The entire Visualize epic is unstarted.

**Evidence:**
- Page at `frontend/src/app/dashboard/visualize/page.tsx` uses `reactflow` for graph rendering
- Has `TableNode` custom node with handles for connections
- Imports `api` from `@/lib/api` only for fetching graph data
- No charting library integration (e.g., recharts, chart.js, d3)

---

### Bug 02 — [High] Visualize page missing all chart types and core features

**Page:** `/dashboard/visualize`
**TRD:** `TRD_DataPlane_Visualize.md` FR2–FR8

**Description:**
Even if we accept the page serves a dual purpose, the following TRD-required features are entirely absent:
- No chart type selector (FR2)
- No dimension/measure assignment UI (FR3)
- No aggregation functions (sum/avg/count/min/max) (FR3)
- No filter controls (FR4)
- No save/load view functionality (FR6)
- No export as PNG or CSV buttons (FR7)
- No loading/empty/error states for chart rendering (implied by FR5)
- No role-scoped data access indication (FR8)

**Impact:** The Visualize module cannot be used for its intended purpose.

---

### Bug 03 — [High] Schema Intel route hijacked by Schema Matcher

**Page:** `/dashboard/schema`
**TRD:** `TRD_DataPlane_Schema_Intel.md` FR1–FR8

**Description:**
The `/dashboard/schema` route labelled "Schema Intel" in the sidebar actually contains a Schema Matcher page that connects to `GET /api/v1/agent/schema-match` and displays source/target table matching results. This is NOT a Schema Intel catalog as defined in the TRD.

The TRD requires:
- Schema catalog search/filter by table, column, type, classification (FR4)
- Column profiling metrics: null rate, distinct count, min/max (FR2)
- Classification badges with confidence scores (FR3)
- Drift detection view showing added/removed/changed elements (FR6)
- Manual classification override with audit (FR5)
- Re-scan trigger from the catalog UI (implied by FR6)

None of these exist. The current page is a third copy of schema-matching functionality (pipelines and schema-mapper also have similar matching UIs).

**Impact:** Users cannot browse discovered schemas, view profiling metrics, or manage classifications.

**Evidence:**
- Page at `frontend/src/app/dashboard/schema/page.tsx` has no catalog search, no profiling display
- Makes calls to `/api/v1/agent/schema-match` not `/api/v1/catalog`
- Hardcodes connection IDs 1 and 2
- Has `SchemaMap` type but uses it for matching, not catalog browsing

---

### Bug 04 — [High] Security page is read-only classification viewer only — ✅ Fixed (2026-07-13)

**Page:** `/dashboard/security`
**TRD:** `TRD_DataPlane_Security.md` FR1–FR9

**Resolution:** Full RBAC + data-protection-policy engine built (`Role`/`Permission`/
`RolePermission`/`UserRole`/`MaskingPolicy`/`RowAccessPolicy` models, `AuthzService` policy
engine, masking/row-filter enforcement wired into Visualize), and the page rebuilt as a 6-tab
admin workspace (Roles / Permissions / Users / Masking / Row Filters / Audit). See
`security_tasks/INDEX.md` for the full breakdown. All 9 FRs done; 60 new backend tests; verified
live with real masking enforcement (viewer role got `***`, exempt admin got the real value, same
query against real seeded data).

---

### Bug 05 — [High] Pipelines page missing core pipeline management features

**Page:** `/dashboard/pipelines`
**TRD:** `TRD_DataPlane_Pipelines.md` FR1–FR10

**Description:**
The Pipelines page is a visual ReactFlow studio for designing transformation pipelines. It is missing almost all TRD-mandated pipeline management features.

Missing:
- Pipeline create form: select source, target, and published mapping (FR1)
- Drift validation display before run (FR2)
- Manual run button (FR3 exists but only for the visual studio, not for saved pipelines)
- Cron-style scheduler with enable/disable (FR4)
- Run history list with start/end time, status, rows processed, errors (FR6)
- Re-run past run functionality (FR8)
- Configurable retry on transient failure (FR7)
- Audit event display (FR9)
- Role-gating indicators (FR10)

**Impact:** Users can execute ad-hoc visual transformations but cannot create, schedule, or monitor proper data pipelines.

**Evidence:**
- Page at `frontend/src/app/dashboard/pipelines/page.tsx` uses ReactFlow for visual pipeline design
- Has no pipeline list/saved pipeline management
- No scheduling UI
- No run history component
- The "Execute Pipeline" button runs on the visual graph, not on a TRD-defined pipeline

---

### Bug 06 — [High] Connectors page missing edit, soft-delete, credential rotation

**Page:** `/dashboard/connectors`
**TRD:** `TRD_DataPlane_Connectors.md` FR6, FR7, FR9

**Description:**
The Connectors page renders a list of connectors with create/test/scan capabilities, but several critical TRD features are missing:

Missing:
- Edit non-secret fields (FR6) — no edit button or modal
- Credential rotation without exposing existing secrets (FR6) — no rotation UI
- Dependency-aware soft delete with warnings (FR7) — delete is not implemented at all
- Live health status auto-polling (FR5 partial — shows health from last test but doesn't poll)
- Audit event display for connector actions (FR9 partial — events emitted but not shown in UI)
- Loading/empty states for individual operations (implied)

**Impact:** Users cannot modify existing connections, rotate credentials, or safely remove connections with dependency warnings.

**Evidence:**
- Page at `frontend/src/app/dashboard/connectors/page.tsx` has no edit button on connector cards
- No delete button or flow
- No credential rotation UI
- Uses inline `fetchConnectors` on mount but no polling/socket for health updates

---

### Bug 07 — [Medium] AskData Bot missing Visualize handoff, conversation persistence, PII indicators

**Page:** `/dashboard/askdata`
**TRD:** `TRD_DataPlane_AskData_Bot.md` FR5, FR7, FR8

**Description:**
The AskData Bot page has a functional chat UI with SQL display toggle, result table, Query Studio handoff, and masked column indicators. However, several TRD features are still missing:

Missing:
- Handoff to Visualize for charting (FR5) — no "Send to Visualize" button exists (Query Studio handoff exists at line 88 of ChatBubble.tsx)
- Conversation context across page reloads (FR8) — sessionId is stored in React state only, not persisted to localStorage/sessionStorage, so context is lost on page refresh
- PII/role guardrail visual indicators (FR6) — masked_columns display exists but no explanation of WHY columns were masked (role vs classification)
- Read-only enforcement display (FR4) — no UI feedback when a write/DDL statement is blocked

**Impact:** Users lose conversation context on page reload and cannot hand off results to Visualize for charting.

**Evidence:**
- `ChatBubble.tsx` has `sendToQueryStudio()` using `sessionStorage` but no equivalent for Visualize
- `page.tsx` stores `sessionId` in `useState` only — not persisted
- `masked_columns` shown as amber text but no role/permission context
- No "Send to Visualize" button in the ChatBubble component

---

### Bug 08 — [Medium] Audit Trail missing retention display, tamper-evidence UI, role-gating

**Page:** `/dashboard/audit`
**TRD:** `TRD_DataPlane_Audit_Trail.md` FR4, FR6, FR7, FR8

**Description:**
The Audit Trail page has a functional FilterBar, EventTable, CorrelationTimeline, ExportButton (with working CSV/JSON export via `api.download()`), and EventDetail components. However, several TRD features are still missing:

Missing:
- Retention policy display (FR6) — no UI showing configurable retention period or expired vs retained ranges
- Tamper-evidence verification UI (FR3) — no button or indicator for integrity verification
- Role-gating of the audit viewer (FR7) — no visual indication of role-based access restrictions
- Correlation tracing (FR8) — verify CorrelationTimeline actually uses correlationId for cross-module tracing (needs verification)

**Impact:** Compliance officers cannot verify audit integrity or understand retention boundaries through the UI.

**Evidence:**
- `ExportButton.tsx` has working CSV/JSON export using `api.download()` — functional
- No retention policy display found in the page or components
- No "Verify Integrity" button found
- No role badge/indicator in the audit page

---

### Bug 09 — [Medium] AI Autopilot missing policy configuration UI

**Page:** `/dashboard/autopilot`
**TRD:** `TRD_DataPlane_AI_Autopilot.md` FR1, FR7, FR8

**Description:**
The AI Autopilot page has PolicyPanel, ApprovalQueue, ActionLog, RunConsole components. However:

Missing/incomplete:
- Policy configuration per action type with autonomy levels (FR1) — verify PolicyPanel supports editing
- Action modification from approval queue (FR7) — verify approve/reject/modify all work
- Rate/volume limits display (FR8) — verify limits are shown and configurable
- Hard prohibition indicators (FR4/FR5) — verify clearly shows actions that are always prohibited
- Recommendation confidence scores (FR2) — verify displayed in ActionLog
- Reversibility notes (FR6) — verify shown in action log

**Impact:** Administrators cannot configure autonomous behavior limits or understand what actions AI Autopilot is prevented from taking.

---

### Bug 10 — [Medium] Query Studio missing autocomplete, write confirmation, handoffs

**Page:** `/dashboard/query-studio`
**TRD:** `TRD_DataPlane_Query_Studio.md` FR1, FR4, FR7, FR8

**Description:**
The Query Studio page has SqlEditor, ResultsTable, HistoryPanel, SavedQueriesPanel, ConnectionSelector, and WriteConfirmModal. However:

Missing/incomplete:
- Schema-aware autocomplete from Schema Intel (FR1) — verify editor provides schema-aware suggestions
- Write/DDL confirmation modal (FR4) — verify WriteConfirmModal is actually connected and functional
- Send-to-Visualize handoff (FR7) — verify button/flow exists
- CSV export of results (FR8) — verify export button exists and works
- Query formatting button (implied by FR1)

**Impact:** Power users cannot safely execute write statements, hand off to visualization, or export results.

---

### Bug 11 — [Medium] Dashboard missing several required widgets

**Page:** `/dashboard`
**TRD:** `TRD_DataPlane_Dashboard.md` FR2, FR5, FR6

**Description:**
The Dashboard page has KPITile, ActivityFeed, TimeRangeFilter, and DashboardWidget components. However:

Missing/incomplete:
- Connector health widget (FR2 lists "connector health widget with status") — verify it exists
- AI Autopilot activity widget (FR2 lists "recent autonomous actions + outcomes") — verify it exists
- Security alerts KPI tile (FR2 lists "open security alerts") — verify it exists
- Pipeline running/failed KPI tiles (FR2) — verify these exist
- Drill-through navigation from ALL widgets (FR5) — verify all widgets link through
- Widget-level error isolation (FR6) — verify one failing widget doesn't break others
- Empty states per widget (FR6) — verify all widgets handle empty data

**Impact:** The dashboard is not providing the unified operational overview promised in the TRD.

---

### Bug 12 — [Medium] Schema Mapper missing AI suggestions, validation, publish flow

**Page:** `/dashboard/schema-mapper`
**TRD:** `TRD_DataPlane_Schema_Mapper.md` FR4, FR5, FR7, FR9, FR10

**Description:**
The Schema Mapper page has Canvas, MappingList, TransformEditor, SuggestionPanel, ValidationPanel, PublishDialog, ExportModal, DraftBar. However:

Missing/incomplete:
- AI suggestion accept/reject (FR4/FR5) — verify SuggestionPanel actually provides accept/reject functionality
- Type-compatibility validation display (FR7) — verify ValidationPanel shows warnings vs blocking errors
- Versioning and publish gating (FR9) — verify PublishDialog blocks on errors and creates immutable versions
- JSON export for Pipelines (FR10) — verify ExportModal works
- Draft autosave indicator (FR8) — verify DraftBar shows autosave status

**Impact:** The core Schema Mapper workflow (AI suggestions → validation → publish → export) may be incomplete.

---

### Bug 13 — [High] No Tenant Isolation management page

**Page:** *(missing)*
**TRD:** Referenced in multiple TRDs as a cross-cutting concern

**Description:**
Multiple TRDs reference tenant isolation as a requirement:
- Connectors TRD: "Mapping definitions are tenant-scoped and isolated"
- Pipelines TRD: "Tenant isolation in execution"
- Dashboard TRD: "Per-tenant cache"

There is no frontend page for managing tenant isolation, viewing tenant boundaries, or configuring tenant-level settings. This is a significant gap for a platform targeting regulated environments.

**Impact:** Administrators cannot view or manage tenant boundaries through the UI.

---

### Bug 14 — [Low] Inline page architecture violates maintainability

**Pages:** `/dashboard/connectors`, `/dashboard/pipelines`, `/dashboard/schema`, `/dashboard/security`, `/dashboard/visualize`

**Description:**
Five pages have all their logic inline in the page file with no component separation:
- `connectors/page.tsx` — 326 lines, all inline
- `pipelines/page.tsx` — 686 lines, all inline
- `schema/page.tsx` — 730 lines, all inline
- `security/page.tsx` — 87 lines, all inline
- `visualize/page.tsx` — 366 lines, all inline

Contrast with well-structured pages like `schema-mapper/` (10 components + hooks + lib), `query-studio/` (7 components + hooks + lib), and `audit/` (6 components + hooks + lib).

**Impact:** The inline pages are harder to test, maintain, and extend. Component reuse across pages is impossible.

---

## FR Coverage Summary by Epic

### Visualize (TRD_DataPlane_Visualize.md)
| FR | Requirement | Status |
|----|------------|--------|
| FR1 | Dataset/result selection as source | ❌ Not done |
| FR2 | Chart types (bar, line, area, pie, scatter, KPI) | ❌ Not done |
| FR3 | Dimensions, measures, aggregations | ❌ Not done |
| FR4 | Interactive filters and sorting | ❌ Not done |
| FR5 | Interactive chart rendering | ❌ Not done (topology graph instead) |
| FR6 | Save/load named views | ❌ Not done |
| FR7 | Export PNG/CSV | ❌ Not done |
| FR8 | Role-scoped data access | ❌ Not done |

### Schema Intel (TRD_DataPlane_Schema_Intel.md)
| FR | Requirement | Status |
|----|------------|--------|
| FR1 | Discover schema structure | ⚠️ Done for matching, not catalog |
| FR2 | Column profiling metrics | ❌ Not done |
| FR3 | Classification with confidence | ❌ Not done |
| FR4 | Search/filter catalog | ❌ Not done |
| FR5 | Manual override classification | ❌ Not done |
| FR6 | Re-scan and drift detection | ❌ Not done |
| FR7 | Bounded sample profiling | ❌ Not done |
| FR8 | Audit events display | ❌ Not done |

### Security (TRD_DataPlane_Security.md)
| FR | Requirement | Status |
|----|------------|--------|
| FR1 | Role CRUD | ❌ Not done |
| FR2 | User role assignment | ❌ Not done |
| FR3 | Role-to-permission mapping | ❌ Not done |
| FR4 | Column-level masking policies | ❌ Not done |
| FR5 | Row-level access filters | ❌ Not done |
| FR6 | Authorization check contract | ❌ Not done |
| FR7 | Session role context display | ✅ Done (Admin Session in sidebar) |
| FR8 | Privileged-change gating | ❌ Not done |
| FR9 | Audit events for security changes | ❌ Not done |

### Pipelines (TRD_DataPlane_Pipelines.md)
| FR | Requirement | Status |
|----|------------|--------|
| FR1 | Create pipeline (source/target/mapping) | ❌ Not done |
| FR2 | Drift validation pre-run | ❌ Not done |
| FR3 | Manual run | ⚠️ Partial (visual studio only) |
| FR4 | Cron scheduling | ❌ Not done |
| FR5 | Execute E-T-L and report status | ⚠️ Partial (visual execution only) |
| FR6 | Run history + re-run | ❌ Not done |
| FR7 | Configurable retry | ❌ Not done |
| FR8 | Re-run past run | ❌ Not done |
| FR9 | Audit events | ❌ Not done |
| FR10 | Role-gating | ❌ Not done |

### Connectors (TRD_DataPlane_Connectors.md)
| FR | Requirement | Status |
|----|------------|--------|
| FR1 | List connector types | ✅ Done |
| FR2 | Create connection | ✅ Done |
| FR3 | Secure credential handling | ⚠️ Partial (UI submits to API, vault status unknown) |
| FR4 | Test Connection with diagnostics | ✅ Done |
| FR5 | Live health status | ⚠️ Partial (shows from test but no auto-polling) |
| FR6 | Edit + credential rotation | ❌ Not done |
| FR7 | Soft-delete with dependency warnings | ❌ Not done |
| FR8 | Schema discovery on demand | ✅ Done (Scan Schema button) |
| FR9 | Audit events display | ❌ Not done |

---

---

## Enhancements (Not TRD-Required but Valuable)

These are features that would significantly improve the product experience but are not explicitly mandated by the current TRDs. They are organized by epic.

### Dashboard Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E01 | **Custom widget layout** — Allow users to drag/reorder widgets on the dashboard grid | TRD explicitly out-of-scope but high-value for power users |
| E02 | **Widget-level export** — Export individual widget data as CSV/PNG from the dashboard | Users often want to share specific metrics without screenshots |
| E03 | **Dashboard notifications bell** — Real-time notification indicator for drift events, pipeline failures, security alerts | Proactive alerting without leaving the dashboard |
| E04 | **Saved dashboard views** — Allow users to save multiple dashboard configurations (e.g., "Ops View", "Compliance View") | Different roles need different signal sets |
| E05 | **Widget refresh interval per widget** — Configurable auto-refresh per widget (e.g., 15s for pipeline status, 5min for KPI counts) | Power users monitoring active pipelines need faster refresh |
| E06 | **Dashboard search** — Global search bar to find connectors, pipelines, mappings, or audit events | Reduces context-switching to navigate between pages |

### Connectors Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E07 | **Bulk test connections** — "Test All" button to test all connections at once | Saves time when diagnosing connectivity issues |
| E08 | **Connection usage graph** — Visual graph showing which pipelines/mappings use a given connection | Helps understand blast radius before deletion |
| E09 | **Connection tags/labels** — Allow users to tag connections (e.g., "production", "staging", "finance") | Better organization for teams with many connections |
| E10 | **Connection cloning** — Duplicate an existing connection as a starting point for a new one | Reduces repetitive form filling for similar connections |
| E11 | **Connection activity timeline** — Per-connection timeline showing test history, schema scans, and credential rotations | Auditability at the connection level |
| E12 | **Connection metrics dashboard** — Per-connection stats: query count, data volume, latency trends | Performance monitoring for data sources |

### Pipelines Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E13 | **Pipeline DAG visualization** — Visual DAG of pipeline steps with real-time progress indicators | Better operational visibility than a flat list |
| E14 | **Pipeline comparison** — Side-by-side diff of two pipeline configurations | Useful for debugging configuration drift |
| E15 | **Pipeline templates** — Pre-built pipeline templates for common patterns (CDC, nightly batch, etc.) | Accelerates pipeline creation |
| E16 | **Pipeline dry-run** — Execute pipeline in dry-run mode to preview row counts and transformations without writing data | Safety check before production runs |
| E17 | **Pipeline notifications** — Email/Slack/webhook notifications on pipeline completion/failure | Proactive alerting without polling the UI |
| E18 | **Pipeline cost estimation** — Estimate compute/storage cost before running a pipeline | Cost governance for regulated environments |

### Query Studio Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E19 | **Query performance insights** — Show query execution time, rows scanned, and optimization suggestions | Helps users write efficient queries |
| E20 | **Query tabs** — Multiple open query tabs in the same session | Power users frequently work with multiple queries |
| E21 | **Query sharing** — Share a saved query with another user via a link | Collaboration without copy-paste |
| E22 | **Query version history** — Track changes to saved queries over time | Audit trail for query evolution |
| E23 | **AI-powered query explanation** — "Explain this query" button that generates plain-English description | Helps non-technical users understand complex SQL |
| E24 | **Query scheduling** — Schedule a saved query to run periodically and email results | Automated reporting without external tools |

### Schema Intel Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E25 | **Schema visual lineage** — Interactive graph showing table/column dependencies across connections | Understanding data flow without reading documentation |
| E26 | **Schema change impact analysis** — "What if" tool showing which pipelines/mappings would break if a column is dropped | Risk assessment for schema changes |
| E27 | **Data quality scorecards** — Per-table quality metrics: completeness, uniqueness, freshness | Trust in data quality at a glance |
| E28 | **Schema comparison view** — Side-by-side diff of two schema versions or two connections | Quickly identify structural differences |
| E29 | **Schema search across all connections** — Global search for table/column names across all connected sources | Finding data across the estate |

### Schema Mapper Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E30 | **Bulk mapping operations** — Select multiple source fields and map them to target fields in one action | Reduces repetitive work for large schemas |
| E31 | **Mapping preview with sample data** — Show a preview of transformed data using sample rows before publishing | Confidence in transformation correctness |
| E32 | **Mapping version diff** — Visual diff between two published mapping versions | Audit and review of mapping changes |
| E33 | **Mapping impact analysis** — Show which pipelines use a mapping before allowing unpublish | Prevents accidental pipeline breaks |
| E34 | **Collaborative mapping** — Multiple users editing the same mapping with conflict resolution | Team-based mapping authoring |

### AI Autopilot Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E35 | **Autopilot confidence dashboard** — Charts showing recommendation accuracy, approval rates, and action outcomes over time | Trust and transparency in autonomous decisions |
| E36 | **What-if simulation** — "What would Autopilot do?" mode that shows recommendations without executing | Safe exploration of autonomous behavior |
| E37 | **Autopilot activity calendar** — Calendar view of all autonomous actions with daily summaries | Compliance review at a glance |
| E38 | **Custom action types** — Allow admins to define custom action types with their own guardrails | Extensibility for unique operational needs |
| E39 | **Autopilot learning mode** — Track which recommendations were accepted/rejected to improve future suggestions | Continuous improvement of suggestion quality |

### AskData Bot Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E40 | **Multi-turn conversation with context** — Follow-up questions that reference previous answers (e.g., "and what about last month?") | Natural conversational flow |
| E41 | **Suggested follow-up questions** — AI-generated suggested questions based on the current answer | Discovery and exploration |
| E42 | **Query result caching** — Cache frequent question results to reduce execution time and load | Performance for common questions |
| E43 | **Natural-language query history** — Searchable history of all NL questions asked | Reuse and audit |
| E44 | **Multi-connection queries** — Ask questions that span multiple connections (e.g., "compare sales from CRM and ERP") | Cross-system analytics |

### Audit Trail Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E45 | **Audit dashboard** — Summary charts: events by module, by actor, by outcome over time | Compliance overview without scrolling through tables |
| E46 | **Scheduled audit reports** — Auto-generate and email audit reports on a schedule (daily/weekly/monthly) | Compliance automation |
| E47 | **Audit anomaly detection** — Flag unusual patterns (e.g., bulk deletes, off-hours access) | Proactive security monitoring |
| E48 | **Custom audit views** — Save named filter combinations as reusable views | Compliance officers have recurring review patterns |
| E49 | **Audit event detail drill-through** — Click an event to see the full before/after payload and related events | Forensic investigation |

### Security Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E50 | **Role preview** — "What can this user see?" preview showing effective permissions across all modules | Reduces misconfiguration risk |
| E51 | **Security policy templates** — Pre-built policy templates for common compliance frameworks (SOC2, HIPAA, GDPR) | Accelerates compliance setup |
| E52 | **Access review reminders** — Scheduled reminders to review role assignments and permissions | Compliance best practice |
| E53 | **Security score** — Overall security posture score based on configured policies, role hygiene, and audit coverage | Gamification of security compliance |
| E54 | **Session management UI** — View and revoke active user sessions | Incident response capability |

### Visualize Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E55 | **Dashboard composition** — Drag-and-drop dashboard builder combining multiple charts | Beyond single-chart views |
| E56 | **Chart annotations** — Add text annotations, trend lines, and reference markers to charts | Context for data stories |
| E57 | **Chart embedding** — Embed a chart in an external page via iframe | Extending insights outside DataPlane |
| E58 | **Automatic chart type suggestion** — Suggest optimal chart type based on selected dimensions and measures | Reduces learning curve |
| E59 | **Chart drill-down** — Click a data point to drill into underlying details | Interactive exploration |

### Cross-Cutting Enhancements
| # | Enhancement | Rationale |
|---|-------------|-----------|
| E60 | **Dark/light theme toggle** — User-selectable theme preference persisted across sessions | Accessibility and preference |
| E61 | **Keyboard shortcuts** — Global keyboard shortcuts for common actions (Ctrl+K for search, etc.) | Power user productivity |
| E62 | **Onboarding wizard** — Guided first-run experience for new users | Reduces time-to-value |
| E63 | **Mobile-responsive layout** — Dashboard and key pages usable on tablet/mobile | Operational monitoring on the go |
| E64 | **User preferences page** — Central page for theme, notifications, default time range, etc. | Personalization |
| E65 | **API documentation viewer** — In-app Swagger/OpenAPI viewer for the DataPlane API | Developer self-service |
| E66 | **Feature flags UI** — Admin UI to enable/disable features per tenant or per user | Gradual rollout and A/B testing |
| E67 | **System health page** — Dedicated page showing service status, version info, and component health | Operations and debugging |
| E68 | **Bulk import/export** — Import/export connectors, mappings, pipelines as JSON/YAML | Migration and backup |
| E69 | **Activity log per entity** — Per-entity activity timeline (e.g., all changes to a specific pipeline) | Granular auditability |
| E70 | **Global search** — Unified search across connectors, pipelines, mappings, queries, audit events | Find anything quickly |

---

## Action Items

### Immediate (Critical/High — Blocks epic delivery)
1. ✅ Build proper Visualize page with chart types, aggregations, filters, save/load, export (2026-07-13)
2. ✅ Build proper Schema Intel catalog page with search, profiling, classifications, drift (2026-07-13)
3. ✅ Build Security admin page with role CRUD, permission matrix, masking policies (2026-07-13)
4. ✅ Build Pipeline management page with create form, scheduler, run history, re-run (2026-07-13)
5. ✅ Add edit/delete/rotate to Connectors page with dependency warnings (done previously)
6. Create Tenant Isolation management page — ADR resolved 2026-07-13; the backend build (tenants table, JWT claim, RLS, service-layer sweep, etc.) was re-scoped to a phased multi-session plan after a same-day build attempt found the real scope ~3-4x larger than estimated — see `tenant_isolation_tasks/00_architecture_decision.md` §9–§10

### Short-term (Medium — Completes epic requirements)
7. Add retention policy display, tamper-evidence verification UI, role-gating indicators to Audit Trail
8. Add policy configuration, rate limits, prohibition indicators to AI Autopilot
9. Add autocomplete, write confirmation, send-to-Visualize, CSV export to Query Studio
10. Add missing widgets (connector health, autopilot activity, security alerts) to Dashboard
11. Add AI suggestion accept/reject, validation display, publish flow to Schema Mapper
12. Add Visualize handoff, conversation persistence, PII guardrail indicators to AskData Bot

### Tech Debt (Low)
13. Refactor inline pages (connectors, pipelines, schema, security, visualize) into component-based architecture