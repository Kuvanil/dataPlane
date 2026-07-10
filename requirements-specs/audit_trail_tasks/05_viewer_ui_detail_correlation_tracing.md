# Task #5 — Viewer UI + detail + correlation tracing (AUDIT-T5)

**TRD reference:** FR4, Usability NFR (§4–5).

**Current state:** No audit viewer UI exists in the frontend.

## Scope

Build the frontend audit log viewer with search/filter, event detail view, and correlation tracing visualization.

### Frontend — Page/Route `/audit`

#### Event list table
- Paginated table with columns: Timestamp, Event Type, Module, Actor, Target, Outcome, Summary.
- Sortable columns (click header to sort).
- Filter bar with inputs for: date range, event type (dropdown), module (dropdown), actor (text), outcome (dropdown).
- Search box for full-text search.
- Real-time or periodic refresh.

#### Event detail view
- Click a row to expand/show a detail panel.
- Shows all canonical fields in a structured layout.
- JSON viewer for `metadata`, `before`, `after` fields.
- Timeline view for correlation tracing.

#### Correlation tracing
- When viewing an event with a `correlation_id`, show a timeline of all related events.
- Visual timeline: horizontal bar chart with events plotted by timestamp, connected by lines.
- Click on any event in the timeline to jump to its detail.

#### Component architecture
```
pages/audit/
  page.tsx                    — Main audit page (/audit)
  components/
    EventTable.tsx            — Paginated, sortable event list
    FilterBar.tsx             — Search + filter inputs
    EventDetail.tsx           — Full event detail panel
    CorrelationTimeline.tsx   — Correlation trace visualization
    JsonViewer.tsx            — Collapsible JSON tree viewer
    ExportButton.tsx          — Export trigger (task #6)
```

### Dependencies
- **AUDIT-T4** — search/filter API.
- **AUDIT-T6** — export endpoint (button trigger).

## Verify
- Event table renders with pagination.
- Filters work correctly (date range, event type, module, actor, outcome).
- Search returns matching events.
- Event detail shows all fields.
- Correlation timeline shows related events in order.

## Risk
Low-Medium. Correlation tracing visualization adds some UI complexity.