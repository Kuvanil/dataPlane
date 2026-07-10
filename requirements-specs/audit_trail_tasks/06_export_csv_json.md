# Task #6 — Export CSV/JSON (AUDIT-T6)

**TRD reference:** FR5 (§4).

**Current state:** No export endpoint exists.

## Scope

Build the export endpoint that streams filtered audit events as CSV or JSON.

### Endpoint — `GET /audit/export?format=csv`

Accepts same filter parameters as AUDIT-T4 search/filter API. Returns the filtered results as a downloadable file.

**CSV format:**
- Header row with column names matching canonical schema fields.
- One row per event, flattened (metadata/before/after as JSON strings in a single column).
- Content-Type: `text/csv`.
- Content-Disposition: `attachment; filename="audit_export_2026-07-09.csv"`.

**JSON format:**
- Newline-delimited JSON (NDJSON) for streaming: one JSON object per line.
- Content-Type: `application/x-ndjson`.
- Content-Disposition: `attachment; filename="audit_export_2026-07-09.jsonl"`.

### Streaming

- Stream results directly from DB cursor to response without loading all events into memory.
- Use server-side cursors for large result sets.
- Respect max export limits (configurable, e.g., 100,000 events per export).

### Dependencies

- **AUDIT-T4** — query layer for filtered results.
- **AUDIT-T5** — export button in UI triggers this endpoint.

## Verify

- Test CSV export with filters produces correct headers and rows.
- Test JSON export with filters produces valid NDJSON.
- Test streaming for large exports (no memory overflow).
- Test export respects row limits.
- Test export with no results returns headers only (CSV) or empty (JSON).

## Risk

Low.