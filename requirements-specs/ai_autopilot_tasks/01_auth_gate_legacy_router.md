# Task 01 — Hotfix: auth-gate the legacy autopilot router

**TRD:** Security NFR ("least-privilege"), FR5. **Severity: HIGH — live vulnerability.**

## Problem

`backend/app/api/routers/autopilot.py` has zero auth on all 4 endpoints. `POST /run` with
`mode="execute"` runs `run_autopilot_task` which executes a pipeline copy into the target
connection — unauthenticated remote data mutation. Same defect class as the connectors
hotfix (2026-07-07).

## Change

In `backend/app/api/routers/autopilot.py`:
- `from app.api.deps import require_role` and `from app.api.routers.auth import get_current_user`,
  `from app.models.user import User`.
- `POST /run` → `user: User = Depends(require_role("admin", "analyst"))`; log/audit `actor=user.email`.
- `GET /runs`, `GET /runs/{id}/logs`, `GET /runs/{id}/status` → `Depends(get_current_user)`.
- Interim until task 06 lands: `mode="execute"` additionally requires role `admin`
  (analyst can suggest-run only). Task 06 replaces direct execution with an
  approval-queue reroute.
- Emit `record_audit(db, "autopilot_run_started", actor=user.email, ...)` on `POST /run`
  (there is currently no audit on start, only on completion).

## Tests

`backend/tests/autopilot/test_router_auth.py` (new dir, copy `tests/mapping/conftest.py`
fixture pattern or share): unauthenticated → 401 on all 4; viewer on POST /run → 403;
analyst + mode=execute → 403; analyst + mode=suggest → 200 (Celery eager or mocked delay).
