# Task #7 — Retention policy + role gating (AUDIT-T7)

**TRD reference:** FR6, FR7 (§4).

**Current state:** No retention policy enforcement exists. No role gating on audit viewer/endpoints exists (the current `GET /audit/` endpoint is accessible to any authenticated user).

## Scope

Implement configurable retention policy with automated cleanup, and role-gated access to the audit viewer and export endpoints.

### Retention policy

**Configuration:**
- `AUDIT_RETENTION_DAYS` (default: 90, configurable via env).
- Events older than this are identified for cleanup.

**Cleanup mechanism:**
- Background task (Celery beat) runs daily.
- Identifies events with `created_at < now - retention_days`.
- Batch deletes in chunks (e.g., 1000 per batch) to avoid long-running transactions.
- Audit the cleanup operation itself (emit an `audit.retention_cleanup` event).
- Dry-run mode: `POST /audit/retention/dry-run` returns count of events that would be deleted without actually deleting.

**Retention indicator:**
- `GET /audit/retention-status` returns:
  ```json
  {
    "retention_days": 90,
    "total_events": 100000,
    "events_in_retention_window": 85000,
    "events_expired": 15000,
    "next_cleanup_at": "2026-07-10T02:00:00Z"
  }
  ```

### Role gating

- `audit_viewer` role: can view events in the viewer UI.
- `audit_exporter` role: can export events.
- `audit_admin` role: can configure retention, view all events, view sensitive event payloads.
- Endpoints are gated with `require_role(...)` dependency matching the existing pattern in the codebase.

### Dependencies

- **AUDIT-T1** — schema with `created_at` for retention.
- **AUDIT-T3** — cleanup must respect append-only if hash chain is used (cleanup is a batch DELETE, which breaks the chain — document that cleanup events are exempt from the chain and are tracked in the audit log themselves).
- **Security/auth** — role/permission system.

## Edge cases

- **Chain break on cleanup** — Deleting old events breaks the hash chain. Document this explicitly. Option: implement "archival" (move expired events to a separate archive table with their chain intact) rather than deletion.
- **Cleanup failure** — If cleanup fails mid-batch, retry on next cycle. Log failures.
- **Retention change** — Changing retention_days applies to next cleanup cycle, not retroactively.

## Verify

- Test retention calculation: events outside window are identified.
- Test batch cleanup deletes in chunks.
- Test dry-run mode returns correct count without deleting.
- Test role gating: viewer role can list but not export; exporter role can export; admin role can configure retention.
- Test unauthorized access returns 403.

## Risk

Low-Medium. Cleanup chain break is the main concern — consider archival to a separate table instead of deletion to maintain chain integrity.