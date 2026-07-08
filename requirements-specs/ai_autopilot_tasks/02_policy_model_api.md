# Task 02 — Autonomy policy model + service + API (FR1)

**TRD:** FR1, AUTO-T1, §11 `AutonomyPolicy`, Reliability NFR (fail-safe defaults).

## Model (`backend/app/models/autopilot.py`, new table)

`AutopilotPolicy`: `id`, `action_type` (unique, one row per type), `autonomy`
(`disabled|suggest|approve|auto`, default `suggest`), `max_auto_per_hour` (int, default from
`Settings.AUTOPILOT_TYPE_AUTO_LIMIT_PER_HOUR`), `updated_by`, `updated_at`. New table only —
`create_all` covers it, no ALTER.

## Service (`backend/app/services/autopilot_service.py`)

- `get_policies(db)` → one entry per action type in the registry (task 04), merging DB rows
  over defaults, so the API always returns the full taxonomy even before any row exists.
- `put_policy(db, action_type, autonomy, max_auto_per_hour, actor)`:
  - 404 unknown action_type (must exist in registry);
  - 422 `autonomy="auto"` when registry says not auto-capable (design decision 5);
  - upsert row, `record_audit("autopilot_policy_changed", payload={before, after})`.

## API (`backend/app/api/routers/autopilot.py`)

- `GET /api/v1/autopilot/policy` — any authenticated user. Returns per-type:
  `{action_type, autonomy, max_auto_per_hour, risk, reversible, auto_capable, description}`
  (registry metadata merged in so the UI needs one call).
- `PUT /api/v1/autopilot/policy/{action_type}` — `require_role("admin")`.

## Config (`backend/app/core/config.py`)

Add `AUTOPILOT_TYPE_AUTO_LIMIT_PER_HOUR` (default 10), `AUTOPILOT_GLOBAL_AUTO_LIMIT_PER_HOUR`
(default 20), `AUTOPILOT_EVALUATE_INTERVAL_MINUTES` (default 2), `AUTOPILOT_BREAKER_THRESHOLD`
(default 3), `AUTOPILOT_BREAKER_WINDOW_MINUTES` (default 60). No hardcoded values in services.

## Tests

Policy defaults are suggest; PUT auto on `migration_execute` → 422; PUT auto on
`connector_health_check` → 200; non-admin PUT → 403; audit row written.
