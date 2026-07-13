# Task #4 — Build Pipeline Management Page

**TRD reference:** `TRD_DataPlane_Pipelines.md` (FR1–FR10)
**Bug(s):** Bug 05 (High)
**Priority:** High

## Current State

The `/dashboard/pipelines` page is a visual ReactFlow studio for designing transformation pipelines with source/target connections, AI matcher, and security mask nodes. It allows ad-hoc execution of visual transformations.

**What exists:**
- ReactFlow canvas with source/AI matcher/mask/target nodes
- Node configuration side panel
- "Execute Pipeline" button for visual graph
- Results panel with table mappings, unmatched tables, generated SQL
- Error banner

**What does NOT exist:**
- Pipeline CRUD: create, list, edit, delete pipelines (FR1)
- Source/target/mapping selector for pipeline definition (FR1)
- Drift validation display before run (FR2)
- Manual run for saved pipelines (FR3)
- Cron-style scheduler with enable/disable (FR4)
- Run history list with start/end time, status, rows, errors (FR6)
- Re-run past run (FR8)
- Configurable retry on transient failure (FR7)
- Audit event display for pipeline actions (FR9)
- Role-gating indicators (FR10)

## Scope

### 1. Rebuild `/dashboard/pipelines` with proper pipeline lifecycle

The current visual studio should be kept as a secondary feature (pipeline designer) but the main page should focus on pipeline management.

### 2. Layout change

```
┌──────────────────────────────────────────────────────┐
│ Pipeline Management                                  │
│ [+ New Pipeline]  [Search...]                        │
├──────────────────────────────────────────────────────┤
│ Pipeline List                                        │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Pipeline Name │ Source → Target │ Schedule │ Runs │ │
│ │──────────────────────────────────────────────────│ │
│ │ Sales Sync    │ CRM → DW        │ Daily    │ 142 │ │
│ │ Customer Load │ API → Postgres  │ Manual   │ 53  │ │
│ │ ...           │                 │          │     │ │
│ └──────────────────────────────────────────────────┘ │
│                                                       │
│ [Designer View] toggle to switch to visual studio    │
└──────────────────────────────────────────────────────┘
```

### 3. Components to build

#### `PipelineList` — Saved pipeline list
- Table view: name, source → target, mapping, schedule, last run status, next run
- Search/filter by name, source, target, status
- Sortable columns
- Click to select and view details
- Loading state: skeleton table
- Empty state: "No pipelines yet — create your first pipeline"
- Error state: error message with retry

#### `PipelineCreateForm` — Create pipeline
- Step 1: Select source connection (dropdown with search, from Connectors API)
- Step 2: Select target connection (dropdown with search)
- Step 3: Select published mapping (from Schema Mapper API, filtered by source/target)
- Step 4: Configure schedule (manual / cron expression)
- Step 5: Configure retry (max retries, delay between retries)
- Step 6: Review and create
- Validation: source and target must be different
- Validation: mapping must be published (not draft)
- Validation: source/target in mapping must match selected connections

#### `PipelineDetail` — Pipeline detail view
- Header: name, status (active/paused/disabled), schedule summary
- Tabs: Overview, Run History, Configuration, Audit

#### `RunHistory` — Run history list
- Table: run ID, start time, end time, status, rows processed, duration, error
- Status badges with colors: running (blue), succeeded (green), failed (red), retrying (amber), cancelled (grey)
- Click to expand and view run details
- Re-run button per failed/completed run
- Pagination for large histories
- Loading/empty/error states

#### `RunDetailPanel` — Run details
- Run metadata: start, end, duration, status, triggered by
- Step-by-step progress (extract → transform → load)
- Row counts per step
- Error details with stack trace (if failed)
- Re-run button
- Link to audit event

#### `ScheduleConfig` — Schedule configuration
- Schedule type: manual / cron
- Cron expression input with presets (every hour, daily, weekly, custom)
- Human-readable description of cron expression
- Enable/disable toggle
- Next run time preview
- Validation: invalid cron expression shows error

#### `RetryConfig` — Retry configuration
- Max retries: number input (0 = no retry)
- Retry delay: number input with unit selector (seconds/minutes)
- Retry on which failures: all / transient only
- Description of retry behavior

#### `PipelineDesigner` — Visual studio (keep existing)
- Move the current ReactFlow visual studio to a sub-route or toggle view
- Should be accessible from the pipeline detail page as "Open Designer"
- Should save back to the pipeline configuration

### 4. Data flow

```
Pipeline list → GET /api/v1/pipelines → PipelineList
              → DELETE /api/v1/pipelines/{id} → soft delete

Create pipeline → POST /api/v1/pipelines → PipelineCreateForm
                → GET /api/v1/connectors → source/target options
                → GET /api/v1/mappings?status=published → mapping options

Pipeline detail → GET /api/v1/pipelines/{id} → PipelineDetail
                → PUT /api/v1/pipelines/{id} → update config

Run history → GET /api/v1/pipelines/{id}/runs → RunHistory
            → POST /api/v1/pipelines/{id}/run → manual run
            → POST /api/v1/runs/{id}/rerun → re-run

Schedule → PUT /api/v1/pipelines/{id}/schedule → ScheduleConfig
         → POST /api/v1/pipelines/{id}/enable
         → POST /api/v1/pipelines/{id}/disable
```

### 5. Route changes

| Current | New | Purpose |
|---------|-----|---------|
| `/dashboard/pipelines` (visual studio) | `/dashboard/pipelines` (management) | Pipeline management home |
| — | `/dashboard/pipelines/new` | Create new pipeline |
| — | `/dashboard/pipelines/{id}` | Pipeline detail view |
| — | `/dashboard/pipelines/{id}/designer` | Visual pipeline designer |

## Dependencies

- Backend: Pipeline CRUD API (PIPE-T1)
- Backend: Run history API (PIPE-T6)
- Backend: Schedule API (PIPE-T4)
- Backend: Execute/rerun API (PIPE-T3)
- Backend: Connectors list API (existing)
- Backend: Published mappings list API (Schema Mapper)

## Edge Cases

- **No connections exist:** Show "Add a connection first" with link to Connectors page, disable create
- **No published mappings exist:** Show "Publish a mapping first" with link to Schema Mapper, disable create
- **Source === target:** Validation error — source and target must be different databases
- **Mapping drift detected:** Show drift warning with details before allowing run
- **Pipeline currently running:** Disable run button, show "Currently running" indicator
- **Schedule overlap:** If a scheduled run is still executing when the next trigger fires, skip the next run and log a warning
- **Re-run of failed pipeline:** Copy the original configuration (not the current pipeline config) — or offer both options
- **Delete pipeline with runs:** Warn that run history will be preserved but pipeline will stop executing
- **Very long run history (>10k runs):** Server-side pagination with date range filter
- **Concurrent run limit:** Show "Max concurrent runs reached" if limit is hit

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- Pipeline list loads and displays pipelines
- Create pipeline form validates all fields
- Pipeline detail shows configuration and runs
- Run history loads with pagination
- Manual run triggers correctly
- Schedule config saves and displays next run time
- Re-run works for completed/failed runs
- Visual designer still works at sub-route
- Loading/empty/error states for all components
- Drift validation warning displays correctly

## Risk

Medium. This is a large refactor of an existing page. Key risks:
1. The current page is well-built for visual design — ensure the management UI doesn't regress the designer
2. Backend pipeline APIs may need to be built/verified
3. The visual designer currently works against a different API than the management page will use — need to reconcile
4. Run history can be very large — pagination and filtering are critical
5. Schedule UI (cron expression) is complex and error-prone — consider presets + validation