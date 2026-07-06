# Task #8 — Audit emission + role gating (PIPE-T8)

**TRD reference:** FR9, FR10, §12 DoD "Role-gated access."

**Status change:** `[ ] → [x] completed`

**Current state:** The existing router (`backend/app/api/routers/pipelines.py`) already has role
gating via `require_role` and audit via `record_audit` on most endpoints:
- `POST /` — `require_role("admin", "analyst")` + `record_audit("pipeline_created")`
- `GET /` — `get_current_user` (any authenticated user)
- `GET /{id}` — `get_current_user`
- `PUT /{id}` — `require_role("admin", "analyst")` + `record_audit("pipeline_updated")`
- `DELETE /{id}` — `require_role("admin")` + `record_audit("pipeline_deleted")`
- `GET /{id}/runs` — `get_current_user`
- `GET /{id}/drift` — `get_current_user` + `record_audit("pipeline_drift_check")`

What's missing: audit/role gating on the new endpoints from Tasks #3, #4, #5, #6, and #9.

## Scope

### Audit events inventory

| Endpoint | Task | Audit event | Role |
|----------|------|-------------|------|
| `POST /pipelines/{id}/run` | #3 | `pipeline_run_started` | admin, analyst |
| `PUT /pipelines/{id}/schedule` | #4 | `pipeline_schedule_updated` | admin, analyst |
| `DELETE /pipelines/{id}/schedule` | #4 | `pipeline_schedule_deleted` | admin, analyst |
| `PATCH /pipelines/{id}/schedule/toggle` | #4 | `pipeline_schedule_toggled` | admin, analyst |
| `PUT /pipelines/{id}/retry-policy` | #5 | `pipeline_retry_policy_updated` | admin, analyst |
| `POST /pipelines/{id}/runs/{run_id}/rerun` | #6 | `pipeline_rerun` | admin, analyst |
| `GET /pipelines/{id}/runs` (filtered) | #6 | (read-only, no audit) | any auth'd user |
| `GET /pipelines/{id}/runs/{run_id}` | #6 | (read-only, no audit) | any auth'd user |

### Role matrix

| Action | viewer | analyst | admin |
|--------|--------|---------|-------|
| List pipelines | ✓ | ✓ | ✓ |
| View pipeline detail | ✓ | ✓ | ✓ |
| View run history | ✓ | ✓ | ✓ |
| View drift status | ✓ | ✓ | ✓ |
| Create pipeline | | ✓ | ✓ |
| Update pipeline (name/enabled) | | ✓ | ✓ |
| Run pipeline | | ✓ | ✓ |
| Schedule pipeline | | ✓ | ✓ |
| Configure retry policy | | ✓ | ✓ |
| Re-run pipeline | | ✓ | ✓ |
| Delete pipeline | | | ✓ |

### Audit payload consistency

All audit events should follow this payload shape:

```python
{
    "pipeline_id": int,
    "action": str,          # e.g. "pipeline_run_started"
    "actor": str,           # user email
    "timestamp": str,       # ISO 8601
    "details": {            # Action-specific
        "run_id": int,      # if applicable
        "cron": str,        # if schedule
        "max_attempts": int, # if retry policy
        "original_run_id": int,  # if rerun
    }
}
```

### Implementation checklist

All endpoints in Tasks #3, #4, #5, #6, and #9 already include `record_audit` calls and
`require_role` decorators in their spec files. This task verifies:

1. **Every mutating endpoint** has a `record_audit` call before `db.commit()`.
2. **Every mutating endpoint** has `require_role("admin", "analyst")` or stricter.
3. **Read-only endpoints** use `get_current_user` (no role restriction).
4. **Delete endpoints** use `require_role("admin")` only.
5. **Audit payloads** never include secrets, raw data values, or connection credentials.
6. **The `pipeline_run` audit** (legacy `POST /execute`) is kept for backward compatibility
   but marked as deprecated.

### Audit helper for pipeline events

Add a convenience helper to reduce boilerplate:

```python
# backend/app/services/pipeline_audit.py (new)

from app.services.audit_helper import record_audit


def audit_pipeline_event(
    db,
    action: str,
    pipeline_id: int,
    actor: str,
    connection_id: int = None,
    details: dict = None,
    status: str = "success",
):
    """Emit a standardized pipeline audit event."""
    payload = {"pipeline_id": pipeline_id}
    if details:
        payload.update(details)

    record_audit(
        db,
        f"pipeline_{action}",
        actor=actor,
        connection_id=connection_id,
        payload=payload,
        status=status,
    )
```

## Dependencies

- Task #1 (router scaffold — already has role gating and audit on CRUD endpoints).
- Tasks #3, #4, #5, #6, #9 (endpoints that need gating — each spec already includes the
  audit/role calls; this task verifies completeness).

## Verify

- Test that each mutating endpoint emits the correct audit event with the correct payload.
- Test that viewers cannot create/update/delete/run pipelines (403).
- Test that analysts cannot delete pipelines (403).
- Test that admins can perform all actions.
- Test that unauthenticated requests return 401 on all endpoints.

## Risk

Low. The `require_role` and `record_audit` utilities are already battle-tested in the
Schema Mapper and Connectors modules. This task is purely additive — wiring existing
utilities onto new endpoints.