# Task #6 — Visualize + Query Studio handoffs (ADB-T6)

**TRD reference:** FR5, FR7 (§4).

**Current state:** No handoff endpoints exist. The existing `query.py` router has a `GET /query/history` endpoint but no "send to visualize" or "edit in studio" functionality. The AskData router has no handoff endpoints at all.

## Scope

Build the handoff endpoints that allow users to send a generated SQL and result set to Query Studio for editing, or to Visualize for charting. Also build the corresponding frontend actions.

### Backend endpoints

#### `POST /askdata/{msg_id}/to-query-studio`

- Accept the message ID (or session_id + message index) from the chat.
- Extract the generated SQL from the stored message.
- Create a new query in Query Studio with the SQL pre-loaded and the connection selected.
- Return a redirect URL or the query ID for the frontend to navigate.

```json
Response: {
  "query_studio_url": "/query-studio?query_id=42",
  "query_id": 42,
  "sql": "SELECT COUNT(*) FROM customers WHERE status = 'active'"
}
```

#### `POST /askdata/{msg_id}/to-visualize`

- Accept the message ID from the chat.
- Extract the result data (columns + rows) from the stored execution.
- Create a new visualization context with the result set pre-loaded.
- Return a redirect URL or visualization ID.

```json
Response: {
  "visualize_url": "/visualize?dataset_id=42",
  "dataset_id": 42,
  "columns": ["count"],
  "rows_available": 1247
}
```

#### `POST /askdata/{msg_id}/export-csv`

- Export the result set as CSV from the chat message execution.
- Return the CSV file directly (Content-Disposition: attachment).

### Frontend actions

- **"Edit in Query Studio" button** — In each bot message's action bar. On click, call the handoff API and navigate to the returned URL.
- **"Visualize" button** — In each bot message's action bar. On click, call the handoff API and navigate to the returned URL.
- **"Download CSV" button** — In each bot message's action bar. On click, trigger file download.

### Dependencies

- **Query Studio (QS-T1/QS-T7)** — Must accept pre-loaded SQL via URL parameter or API.
- **Visualize** — Must accept result data from an external source.
- **Task #1** — Generated SQL must be stored with the message for retrieval.
- **Task #3** — Result data must be stored with the message for visualization export.

## Edge cases

- **Message has no SQL** (e.g., clarification response) — Disable "Edit in Query Studio" button.
- **Message has no result set** (e.g., query failed) — Disable "Visualize" and "Export CSV" buttons.
- **Handoff target not available** — Return 503 with appropriate message. Frontend shows "Service unavailable" tooltip.
- **Large dataset for Visualize** — Only pass column definitions + row count, not full data. Visualize should fetch data on its own from the execution context.

## Verify

- Test handoff endpoint creates Query Studio context with correct SQL.
- Test handoff endpoint creates Visualize context with correct columns.
- Test CSV export returns properly formatted file.
- Test frontend buttons navigate to correct URLs.
- Test buttons are disabled when SQL/results are not available.

## Risk

Low. These are straightforward API endpoints that coordinate between modules. The main risk is coupling to other modules' APIs, which should be mitigated by clear contracts.