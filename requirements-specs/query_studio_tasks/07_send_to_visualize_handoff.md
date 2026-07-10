# Task #7 — Send-to-Visualize handoff (QS-T7)

**TRD reference:** FR7 (§4).

**Current state:** No handoff endpoint exists.

## Scope

Build the endpoint that sends a query result set to Visualize for charting.

### Endpoint — `POST /query/{query_id}/to-visualize`

- Accept a query ID (from a previously executed query).
- Extract the result metadata (columns, row count) from the stored execution.
- Create a visualization context with the result data available.
- Return a redirect URL or visualization ID.

```json
Response: {
  "visualize_url": "/visualize?dataset_id=42",
  "dataset_id": 42,
  "columns": [{"name": "count", "type": "integer"}],
  "rows_available": 1247
}
```

### Frontend — "Visualize" button

- In the results toolbar, add a "Visualize" button.
- On click, call the handoff API and navigate to the returned URL.
- Disabled if no result data available.

### Dependencies

- **Visualize** — Must accept result data from external source.
- **QS-T1** — execution service provides the result data.

## Verify

- Test handoff endpoint creates Visualize context with correct columns.
- Test frontend button navigates to Visualize.

## Risk

Low.