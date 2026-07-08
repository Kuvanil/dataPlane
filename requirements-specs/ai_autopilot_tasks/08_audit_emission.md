# Task 08 — Audit emission sweep (FR9)

**TRD:** FR9, AUTO-T8. Mostly woven through tasks 01–07; this task is the checklist + gap-fill.

Every one of these must produce an `AuditLog` row via `record_audit` (payloads include
recommendation id, action_type, actor, and outcome where applicable):

| Event | event_type |
|---|---|
| Policy changed | `autopilot_policy_changed` |
| Evaluation ran (manual or beat) | `autopilot_evaluated` |
| Recommendation created / refreshed | `autopilot_recommendation_created` |
| Recommendation superseded (trigger cleared / policy disabled) | `autopilot_recommendation_superseded` |
| Approved / rejected / modified | `autopilot_recommendation_approved|rejected|modified` |
| Execution started (run console) | `autopilot_run_started` (task 01) |
| Execution finished | `autopilot_action_executed` (status success/failure) |
| Prohibited blocked | `autopilot_action_blocked` |
| Rate limited / breaker | `autopilot_rate_limited` / `autopilot_circuit_breaker_open` |
| Auto demoted to queue | `autopilot_auto_demoted` |

Verification: a pytest that walks one full lifecycle (create → approve → execute) and asserts
the audit trail contains created/approved/executed rows in order; plus a live check that the
events render in the dashboard Audit feed (it reads `GET /audit/`).
