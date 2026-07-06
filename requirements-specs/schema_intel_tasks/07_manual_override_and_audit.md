# Task #7 — Manual override + full audit coverage (SI-T7)

**TRD reference:** FR5, FR8, §12 DoD "Override works and is audited."

**Current state:** NOT STARTED for override; PARTIAL for audit. Grep for `override`,
`manual.?classif`, `classification_override` across `backend/app` returns zero matches — no
endpoint exists to change a classification, and there's no persisted classification row to attach
an override to (today's classification is recomputed live on every `GET /{id}/classify` call, per
Task #3's current-state notes). The audit *infrastructure* is solid and already reused across
features: `AuditLog` model (`backend/app/models/audit.py:6-17`), `record_audit()` helper
(`backend/app/services/audit_helper.py:41-70`, SAVEPOINT-isolated so audit writes can't break a
caller's transaction), already wired to `schema_classified`
(`backend/app/api/routers/schema.py:54`) and `schema_drift_detected`
(`backend/app/tasks/ai_tasks.py:306-322`, written directly rather than via the helper — worth
normalizing to use `record_audit()` for consistency while touching this area, minor cleanup, not
required). No `schema_scanned` or `classification_overridden` event type exists yet because
neither the scan endpoint (Task #1) nor the override endpoint (this task) exist yet.

## Scope

### Router — extend `backend/app/api/routers/schema_catalog.py` (Task #1) or `schema.py`

`PATCH /api/v1/catalog/columns/{column_id}/classification` — body: `{label, level, reason}`.
Updates (or inserts, if none exists yet) the `ColumnClassification` row from Task #3 with an
`overridden_by` (actor) and `overridden_at` field (add these two columns to
`ColumnClassification` as part of this task), and calls `record_audit(db, "classification_overridden",
actor=..., connection_id=..., payload={"column_id":..., "before": {...}, "after": {...}, "reason": ...})`
— matching the before/after audit payload shape already used by
`MappingService.update_edge_transformation` (`backend/app/services/mapping_service.py`) rather
than inventing a new audit payload convention.

### Audit completeness

- Add a `schema_scanned` audit event, emitted from Task #1's `scan_connection()` — currently no
  event marks "a scan happened," only its two downstream effects (`schema_classified`,
  `schema_drift_detected`) are audited. This closes the FR8 "audit events for scans" gap
  literally, not just for classification/override.
- Confirm `record_audit()` is used (not a direct `AuditLog(...)`/`db.add()`) for every new event
  type this epic introduces, for the SAVEPOINT-isolation guarantee `audit_helper.py` provides.

### Role gating

Restrict the override endpoint to `admin`/`analyst` roles, matching the `require_role` pattern
already used for mutating Schema Mapper/Pipelines endpoints — a `viewer` overriding a PII
classification is a governance concern the TRD's Security stakeholder row exists to catch.

## Dependencies

- Task #1 (catalog + scan to emit `schema_scanned` from).
- Task #3 (`ColumnClassification` rows to override).

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/test_override.py -v
```
- Override a classification; confirm the row updates, `overridden_by`/`overridden_at` are set, and
  an `AuditLog` row with `event_type="classification_overridden"` and a correct before/after
  payload exists.
- Confirm a `viewer`-role actor gets 403 on the override endpoint.

## Risk

Low-medium. The audit mechanism is proven; the only new risk is getting the override's
before/after payload accurate (a wrong "before" value in an audit trail is worse than no audit at
all for a compliance-sensitive feature) — worth an explicit test asserting payload contents, not
just that an audit row exists.
