# Task #2 — Build Proper Schema Intel Catalog Page

**TRD reference:** `TRD_DataPlane_Schema_Intel.md` (FR1–FR8)
**Bug(s):** Bug 03 (High)
**Priority:** High

## Current State

The `/dashboard/schema` route labelled "Schema Intel" in the sidebar contains a Schema Matcher page that connects to `GET /api/v1/agent/schema-match` and displays source/target table matching results. This is NOT a Schema Intel catalog as defined in the TRD.

**What exists:**
- Source/target connection selectors
- Schema preview panels (list of tables per connection)
- "Analyze Schema" button that triggers AI schema matching
- Table pair matching results with confidence scores
- Column-level match details
- Unmatched tables display

**What does NOT exist:**
- Searchable schema catalog (FR4)
- Column profiling metrics (FR2): null rate, distinct count, min/max
- Classification badges with confidence scores (FR3)
- Drift detection view (FR6): added/removed/changed elements
- Manual classification override (FR5)
- Re-scan trigger from the catalog UI

## Scope

### 1. Create new Schema Intel catalog page at `/dashboard/schema`

The current Schema Matcher functionality should be moved to a new route (e.g., `/dashboard/schema/matcher`). The `/dashboard/schema` route becomes the Schema Intel catalog.

### 2. Components to build

#### `SchemaSearchBar` — Search and filter
- Free-text search across table and column names
- Filter by connection, data type, classification
- Filter by table only / columns only / both
- Recent searches dropdown

#### `SchemaTableList` — Table catalog
- Paginated/tabular list of all discovered tables
- Columns: table name, connection, column count, row estimate, last scanned, classification summary
- Sortable by any column
- Click to expand and view columns
- Loading state: skeleton table rows
- Empty state: "No schemas discovered — scan a connection"
- Error state: error message with retry

#### `ColumnProfilingCard` — Per-column profiling metrics
- Data type, nullable, primary key indicators
- Null rate percentage with visual bar
- Distinct count / cardinality
- Min/max values (where applicable)
- Sample values (first 5)
- Classification badge with confidence
- PII indicator with category

#### `ClassificationBadge` — Classification display
- Color-coded badge per classification category (PII, sensitive, public, etc.)
- Confidence score shown as percentage
- Tooltip with classification details
- Manual override button for authorized roles

#### `DriftView` — Schema drift detection
- Timeline of scans for a connection
- Added tables/columns highlighted in green
- Removed tables/columns highlighted in red
- Changed columns (type change, nullability change) highlighted in amber
- Accept/reject drift changes (for mapping updates)
- Empty state: "No drift detected"

#### `ClassificationOverrideDialog` — Manual override
- Select classification category
- Add reason/justification
- Confirm override (requires audit event)
- Shows current classification and confidence

### 3. Data flow

```
User lands on /dashboard/schema → GET /api/v1/catalog → SchemaTableList
                                                      ↓
User clicks a table → GET /api/v1/catalog/columns/{tableId} → ColumnProfilingCard
                                                      ↓
User filters/search → GET /api/v1/catalog?search=&type=&connection_id= → updated list
                                                      ↓
User views drift → GET /api/v1/connections/{id}/drift → DriftView
                                                      ↓
User overrides classification → PATCH /catalog/columns/{id}/classification → audit event
```

### 4. Route changes

| Current | New | Purpose |
|---------|-----|---------|
| `/dashboard/schema` (schema matcher) | `/dashboard/schema` (catalog) | Schema Intel catalog |
| — | `/dashboard/schema/matcher` | Moved schema matcher |
| — | `/dashboard/schema/connection/{id}` | Per-connection schema detail |

### 5. Sidebar update

- Keep "Schema Intel" in sidebar pointing to `/dashboard/schema`
- No sidebar change needed

## Dependencies

- Backend: `GET /api/v1/catalog` search endpoint (SI-T4)
- Backend: `GET /api/v1/catalog/columns/{id}` column detail with profiling (SI-T2)
- Backend: `GET /api/v1/connections/{id}/drift` drift events (SI-T6)
- Backend: `PATCH /catalog/columns/{id}/classification` override endpoint (SI-T7)
- Backend: `POST /connections/{id}/scan` scan trigger (SI-T1)

## Edge Cases

- **No connections exist:** Show "Add a connection first" with link to Connectors page
- **No schemas discovered yet:** Show "Scan a connection to discover schemas" with scan button
- **Partial scan results:** Some tables scanned, some failed — show partial results with error indicators
- **Very large catalogs (1000+ tables):** Server-side pagination + search; frontend only loads current page
- **Stale classifications:** Show "Classification may be stale — re-scan recommended" warning
- **Override conflicts:** If classification was overridden, then re-scan finds a different classification, show both with "manual override" vs "automated" labels
- **Drift with no baseline:** First scan has no drift — show "Baseline established. Future changes will appear here."

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- Catalog loads and displays discovered tables
- Search/filter works and re-queries correctly
- Column detail shows profiling metrics and classification
- Drift view shows added/removed/changed elements with correct colors
- Classification override saves and emits audit event
- Re-scan triggers from the UI
- Schema matcher still works at new route
- Loading/empty/error states display correctly

## Risk

Medium. This is a new page with multiple components. Key risks:
1. Backend catalog API may not exist yet — may need parallel backend work
2. Profiling metrics depend on async scan jobs completing — may show stale or partial data
3. Schema matcher relocation may break existing links
4. Classification taxonomy must be defined and approved before override UI can be built