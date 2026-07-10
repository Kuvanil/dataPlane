# Task #3 — Append-only store + tamper-evidence (AUDIT-T3)

**TRD reference:** FR2, FR3, Security NFR (§4–5).

**Current state:** The `audit_log` table is a standard SQL table with no append-only enforcement. Rows can be edited or deleted through direct DB access. No hash chaining or tamper-evidence exists.

## Scope

Implement append-only enforcement and tamper-evidence via hash chaining for the audit store.

### Hash chain implementation

```python
class AuditLog(Base):
    # ... existing columns ...
    # New columns:
    event_hash = Column(String, nullable=False)     # SHA-256 of this event's content
    prev_hash = Column(String, nullable=True)       # SHA-256 of the previous event's hash
    sequence = Column(Integer, nullable=False)       # Monotonically increasing sequence number
```

**Hashing algorithm:**
- `event_hash = SHA256(canonical_json_of_event + "|" + prev_hash)`
- The first event has `prev_hash = None` and is the "genesis" event.
- The hash covers all canonical fields of the event (excluding the hash fields themselves).
- Use canonical JSON serialization (sorted keys, no whitespace) to ensure deterministic hashing.

**Chain verification — `POST /audit/verify`**

```json
Response: {
  "valid": true,
  "total_events": 10000,
  "verified_events": 10000,
  "chain_broken_at": null,
  "tampered_events": []
}
```

Walk the chain from the genesis event forward, recomputing hashes and comparing with stored values. Report any mismatches.

### Append-only enforcement

**API level:**
- `DELETE /audit/events` is NOT implemented (no delete endpoint).
- `PUT /audit/events/{id}` is NOT implemented (no update endpoint).
- The existing `GET /audit/` and `GET /audit/{id}` are read-only.

**DB level:**
- No DELETE or UPDATE triggers on the audit_log table would be ideal.
- At minimum, document that the DB user used by the application should have only INSERT and SELECT privileges on `audit_log`.
- Consider a DB trigger that prevents DELETE/UPDATE on `audit_log`.

## Dependencies

- **AUDIT-T1** — canonical schema for deterministic serialization.
- **AUDIT-T2** — ingestion must compute and store hash at write time.

## Edge cases

- **Genesis event** — `prev_hash = None`, verified separately.
- **Concurrent writes** — Sequence numbers prevent race conditions. Use a DB sequence or counter.
- **Hash collision** — SHA-256 collision probability is negligible for this use case.
- **Verification performance** — Full chain walk is O(n). For very large tables, verify in chunks with periodic checkpoint hashes.
- **Backfill** — Existing events (before this task) cannot be hashed retroactively. Mark them with `event_hash = "pre-hash"` and `prev_hash = None`.

## Verify

- Test hash chain: insert 3 events, verify chain is valid.
- Test tamper detection: modify an event's payload in DB, verify detects tampering.
- Test API-level append-only: POST succeeds, PUT/DELETE return 405.
- Test verification endpoint returns correct chain health.
- Test concurrent inserts maintain chain integrity.

## Risk

Medium-High. Hash chaining is well-understood but needs careful implementation for correctness. The verification mechanism must be performant enough for production use. Sequence ID management needs atomicity guarantees.