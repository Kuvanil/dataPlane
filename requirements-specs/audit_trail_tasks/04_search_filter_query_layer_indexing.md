# Task #4 — Search/filter query layer + indexing (AUDIT-T4)

**TRD reference:** FR4, Performance NFR (§4–5).

**Current state:** The existing `GET /audit/` endpoint supports basic filtering by `event_type`, `connection_id`, and `status`. No full-text search, no date range filtering, no actor/target/module filters, no faceted search, no correlation tracing.

## Scope

Build the comprehensive search/filter query layer with appropriate indexing for fast retrieval at scale.

### Search/filter API — `GET /audit/events`

```
GET /audit/events?actor=user@example.com
                 &module=connectors
                 &event_type=connector.created
                 &target_type=connection
                 &target_id=42
                 &correlation_id=uuid-abc-123
                 &outcome=failure
                 &date_from=2026-01-01T00:00:00Z
                 &date_to=2026-07-09T23:59:59Z
                 &search=text_search_in_summary
                 &page=1
                 &page_size=50
                 &sort_by=timestamp
                 &sort_order=desc
```

- All filter parameters are optional.
- `search` performs full-text search on the `summary` and `event_type` fields.
- `correlation_id` returns all events in a correlation chain, ordered by `sequence`.
- Date range filters on `created_at`.
- Multiple filters combine with AND logic.

### Indexing strategy

Add indexes for common query patterns:
- `(correlation_id, sequence)` — for correlation tracing queries.
- `(actor, created_at)` — for actor-based queries.
- `(module, event_type, created_at)` — for module-based queries.
- `(target_type, target_id, created_at)` — for target-based queries.
- `(event_type, created_at)` — for event type queries.
- `(created_at)` — for date range queries.

### Faceted search — `GET /audit/facets`

Return aggregate counts for filter dimensions to power a faceted search UI:
```json
{
  "modules": {"connectors": 500, "query_studio": 200, "askdata": 50},
  "event_types": {"connector.created": 100, "query.executed": 150},
  "outcomes": {"success": 700, "failure": 30, "warning": 20},
  "actors": {"admin": 400, "analyst@example.com": 100},
  "date_range": {"earliest": "2026-01-01T00:00:00Z", "latest": "2026-07-09T23:59:59Z"}
}
```

### Response format

```json
{
  "events": [AuditEvent, ...],
  "total": 5000,
  "page": 1,
  "page_size": 50,
  "has_more": true,
  "facets": {...}
}
```

### Dependencies

- **AUDIT-T1** — canonical schema defines the filterable fields.
- **AUDIT-T2** — events are stored with canonical fields populated.
- **AUDIT-T3** — events have sequence numbers for ordering.

## Verify

- Test each filter parameter individually.
- Test combined filters (AND logic).
- Test date range filtering.
- Test correlation_id returns all related events ordered by sequence.
- Test full-text search on summary field.
- Test pagination with filters.
- Test faceted search returns correct counts.

## Risk

Medium. Query performance at scale depends on proper indexing. The faceted search endpoint needs separate count queries which can be expensive on large tables. Consider materialized aggregations or approximate counts for very large datasets.