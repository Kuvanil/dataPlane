# Task 06 — Approval queue API + bounded executor (FR3, FR4, FR7)

**TRD:** FR3, FR4, FR7, AC1/AC2/AC4, AUTO-T4/T5, Reliability NFR (idempotent application).

## Queue API (`backend/app/api/routers/autopilot.py`)

- `GET /api/v1/autopilot/recommendations?status=&limit=&offset=` — any authenticated user;
  newest first; default `status=pending`.
- `POST /api/v1/autopilot/recommendations/{id}/approve` — `require_role("admin")`. Guarded
  transition `pending → approved` (409 if already decided), then dispatch execute task.
- `POST /api/v1/autopilot/recommendations/{id}/reject` — admin; body `{reason?}`;
  `pending → rejected`.
- `POST /api/v1/autopilot/recommendations/{id}/modify` — admin; body `{payload}`; validates via
  registry `validate_payload`; stores `modified_by/at`; stays `pending` (modify-then-approve, FR7).
- `GET /api/v1/autopilot/actions?limit=&offset=` — action log, any authenticated user.

## Executor (`backend/app/services/autopilot_service.py` + `app/tasks/autopilot_tasks.py`)

`execute_recommendation_task(recommendation_id)` (Celery):
1. Guarded UPDATE `approved → executing` (or `pending → executing` for the auto path with
   `decision_mode="auto"`) — 0 rows ⇒ someone else won; exit quietly (idempotency).
2. `check_action_allowed(action_type)` — prohibited/unknown ⇒ `AutopilotActionLog` row with
   `outcome=blocked_prohibited`, rec → `failed`, audit. **This check runs here regardless of
   what any policy row says** (AC3, defense in depth after the policy API's own validation).
3. Auto path only: re-check policy is still `auto`, action still `auto_capable`, rate limits +
   breaker (task 07) — any failure demotes: rec back to `pending` (approval queue), audit
   `autopilot_auto_demoted`, log row `blocked_*`.
4. Run `spec.execute(db, payload, actor)`; write `AutopilotActionLog` (`success|failure` +
   detail + reversibility_note), rec → `executed|failed` with `execution_result`, audit.

Auto path entrypoint: `maybe_auto_execute(db, rec)` called by the engine after creating each
rec — if policy for the type is `auto`, dispatch the execute task with the auto flag; if
`suggest`/`approve`, leave pending (AC1/AC2); if `disabled`, mark rec `superseded` immediately
(policy says don't even queue it) with audit.

## Legacy execute reroute

`POST /autopilot/run` with `mode="execute"` no longer executes: it creates a `migration_execute`
recommendation (`created_by=user.email`, rationale templated from the request) and returns
`{recommendation_id, status: "queued_for_approval"}` with HTTP 202. `mode="suggest"` unchanged.
Approving it dispatches the legacy task exactly as before. Frontend console updated in task 09.

## Tests

Approve executes exactly once under double-approve race (guarded transition); reject never
executes; modify validates payload; suggest-only rec never auto-dispatches; disabled policy
supersedes; legacy execute returns 202 + rec, and approval runs it (Celery eager/mocked).
