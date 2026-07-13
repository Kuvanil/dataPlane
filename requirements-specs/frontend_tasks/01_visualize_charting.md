# Task #1 — Build Proper Visualize Page with Charting

**TRD reference:** `TRD_DataPlane_Visualize.md` (FR1–FR8)
**Bug(s):** Bug 01 (Critical), Bug 02 (High)
**Priority:** Critical

## Current State

The `/dashboard/visualize` page renders a Database Topology Graph (ReactFlow-based graph showing source/target table relationships with risk annotations). This is an entirely different feature from the Visualization workspace specified in the TRD. The page has:
- A `TableNode` custom ReactFlow node component
- Source/target connection pickers
- View mode toggles (all/source/target)
- An issue/annotations side panel
- Summary stat cards

**What does NOT exist:**
- No chart types (bar, line, area, pie, scatter, KPI)
- No dimension/measure assignment UI
- No aggregation functions (sum/avg/count/min/max)
- No filter controls
- No save/load view functionality
- No export as PNG or CSV
- No charting library integration (recharts, chart.js, d3, etc.)

## Scope

### 1. Create new charting page at `/dashboard/visualize`

Replace the current topology graph with a proper visualization workspace. The topology graph functionality should be moved to a new route (e.g., `/dashboard/schema/topology` or `/dashboard/visualize/topology`).

### 2. Components to build

#### `ChartTypeSelector` — Chart type picker
- Options: table, bar, line, area, pie, scatter, KPI/single-value
- Visual card-based selector with preview icons
- Disabled state when no dataset is selected

#### `FieldConfigPanel` — Dimension/measure assignment
- Drag-and-drop or select-based field assignment
- Dimension field (X-axis / category)
- Measure field (Y-axis / value) with aggregation selector (sum/avg/count/min/max)
- Multiple measures support for multi-series charts
- Color assignment per measure

#### `FilterBar` — Interactive filters
- Add/remove filter conditions on any field
- Filter types: equals, not equals, greater than, less than, contains, between
- Date range picker for date fields
- Clear all filters button

#### `ChartCanvas` — Chart rendering area
- Renders the selected chart type with configured fields
- Interactive: hover tooltips, legend toggling, zoom (where applicable)
- Loading state: skeleton shimmer
- Empty state: "Select fields to build your chart" message
- Error state: error message with retry button
- Responsive: fills available container width

#### `SaveViewDialog` — Save/load named views
- Save current configuration with a name
- Load previously saved views from a dropdown/list
- Delete saved views
- Views stored via API (`POST /viz/views`, `GET /viz/views`)

#### `ExportMenu` — Export options
- Export chart as PNG image
- Export underlying data as CSV
- Loading state during export generation
- Error handling for failed exports

### 3. Data flow

```
User selects dataset → ChartTypeSelector → FieldConfigPanel → FilterBar
                                                          ↓
                                              ChartCanvas (renders)
                                                          ↓
                                              SaveViewDialog / ExportMenu
```

- Dataset source: Query Studio saved results (`POST /viz/query`) or connection + table selection
- API: `POST /viz/query` with dimensions, measures, filters → aggregated rows
- API: `POST /viz/views`, `GET /viz/views/{id}` for save/load

### 4. Route changes

| Current | New | Purpose |
|---------|-----|---------|
| `/dashboard/visualize` (topology graph) | `/dashboard/visualize` (charting) | Main visualization workspace |
| — | `/dashboard/visualize/topology` | Moved topology graph |
| — | `/dashboard/visualize/new` | New chart from scratch |
| — | `/dashboard/visualize/view/{id}` | Load saved view |

### 5. Sidebar update

- Keep "Visualize" in sidebar pointing to `/dashboard/visualize`
- Add a submenu or secondary link for topology: "Schema Topology" → `/dashboard/visualize/topology`

## Dependencies

- Charting library (recommend: recharts for React-native charting with good TypeScript support)
- Backend: `POST /viz/query` aggregation endpoint (VIZ-T1)
- Backend: `POST /viz/views`, `GET /viz/views/{id}` save/load endpoints (VIZ-T5)
- Backend: `POST /viz/export` for CSV export (VIZ-T6)
- Query Studio: saved results must be referenceable as visualization sources

## Edge Cases

- **No dataset selected:** Show empty state with "Select a dataset to begin" message
- **Large datasets (>50k rows):** Server-side aggregation/sampling; show indicator "Aggregated from N rows"
- **Incompatible field types:** Warn when a text field is assigned as measure or numeric as dimension
- **Empty results after filtering:** Show "No data matches your filters" with clear filters button
- **Chart type incompatible with field config:** Gray out incompatible chart types (e.g., pie requires exactly one dimension + one measure)
- **Rapid filter changes:** Debounce filter changes (300ms) before re-querying
- **Browser print:** Charts should render at high resolution for print layouts
- **Accessibility:** Charts need aria-labels, keyboard navigation for tooltips, and data table fallback

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- All chart types render with sample data
- Field configuration changes re-render the chart
- Filters apply correctly and re-query
- Save/load view round-trips correctly
- Export PNG downloads a valid image
- Export CSV downloads valid CSV
- Loading/empty/error states display correctly
- Topology graph still works at new route

## Risk

Medium. This is a large frontend effort (new page, multiple components, charting library integration). The main risks are:
1. Charting library choice — must support all required chart types with good React integration
2. Performance with large datasets — server-side aggregation is critical
3. Backend API availability — the visualization endpoints may not exist yet
4. Topology graph relocation — existing users/bookmarks will break; add redirect