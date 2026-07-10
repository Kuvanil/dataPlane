# Task #5 — Results table + CSV export (QS-T5)

**TRD reference:** FR3, FR8 (§4).

**Current state:** No results display UI exists. No CSV export endpoint exists.

## Scope

Build the paginated results table that renders below the SQL editor after execution, with column headers, row data, pagination controls, and CSV export.

### Frontend — ResultsTable component

- **Column headers** — Rendered from the `columns` response metadata with sort indicators.
- **Row data** — Scrollable table body with alternating row colors.
- **Pagination** — Page controls (Previous/Next, page numbers) driven by `page`, `page_size`, `has_more`.
- **Row count** — "Showing 1-100 of 1,247 rows" indicator.
- **CSV export button** — Triggers `GET /query/{query_id}/export?format=csv` and downloads the file.
- **Column sorting** — Client-side sorting of displayed page (or server-side sort with re-execution).
- **Empty state** — "Run a query to see results" placeholder when no query executed.
- **Error state** — Display error message with the SQL that caused it.

### Backend — `GET /query/{query_id}/export?format=csv`

- Stream the full result set as CSV with proper headers.
- Use `Content-Disposition: attachment; filename="query_{query_id}.csv"`.

### Dependencies

- **QS-T1** — execution service for result data.
- **QS-T4** — editor UI (results display below the editor).

## Verify

- Results table renders with column headers and row data.
- Pagination controls work correctly.
- CSV download produces valid CSV file.
- Column sorting works on client side.
- Empty/error states render correctly.

## Risk

Low. Standard data table pattern. CSV streaming for large results needs attention to memory usage.