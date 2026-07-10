# Task #2 — Ingestion API + durable buffering (AUDIT-T2)

**TRD reference:** FR1, Reliability NFR (§4–5).

**Current state:** Audit events are ingested via the `record_audit` helper which writes directly to the DB in the caller's transaction. No dedicated ingestion endpoint exists. No buffering, retry, or backpressure mechanism.

## Scope

Build the dedicated ingestion API endpoint with durable buffering, validation against the canonical schema, and backpressure handling.

### Endpoint — `POST /audit/events`

```json
Request: {
  "events": [
    {
      "event_type": "connector.created",
      "actor": "user@example.com",
      "module": "connectors",
      "target_type": "connection",
      "target_id": 42,
      "target_name": "prod-db",
      "before": null,
      "after": {"name": "prod-db", "type": "postgres"},
      "correlation_id": "uuid-abc-123",
      "outcome": "success",
      "summary": "Created connection 'prod-db'",
      "timestamp": "2026-07-09T12:00:00Z",
      "duration_ms": 150,
      "metadata": {}
    }
  ]
}

Response: {
  "accepted": 5,
  "rejected": 0,
  "errors": []
}
```

- Accepts a batch of events (max 100 per request).
- Validates each event against the canonical schema (AUDIT-T1).
- Returns `accepted`/`rejected` counts with per-event errors for rejected entries.
- Events failing validation are rejected individually, not blocking the batch.

### Durable buffering

- Write events to a durable queue (Redis/Celery or in-process queue with DB fallback) before persisting.
- Queue provides retry with backoff on DB write failures.
- Configurable retry policy (e.g., 3 retries with exponential backoff).
- Circuit breaker pattern: if DB is down, queue accumulates events up to a configurable limit.
- Background consumer processes the queue and writes to the audit store.

### Reliability

- No event loss: events are acknowledged to the caller only after being enqueued durably.
- If the queue is full, return 503 with Retry-After header.
- Monitor queue depth and DB write latency.

### Dependencies

- **AUDIT-T1** — canonical schema definition for validation.
- **Queue infrastructure** — Redis/Celery or similar.

## Verify

- Test batch ingestion accepts valid events.
- Test batch ingestion rejects individual invalid events while accepting valid ones.
- Test queue-based buffering survives temporary DB outage.
- Test backpressure: queue full returns 503.
- Test retry mechanism on transient DB failures.

## Risk

Medium. Queue infrastructure adds operational complexity. The buffering strategy needs to be tuned for expected event volumes.