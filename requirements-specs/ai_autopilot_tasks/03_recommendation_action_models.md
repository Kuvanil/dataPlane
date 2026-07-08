# Task 03 — Recommendation + action-log data models (FR2, FR6)

**TRD:** FR2, FR6, §11 data model (with the `ApprovalRequest`-folded-into-status deviation,
INDEX design decision 1).

## Models (`backend/app/models/autopilot.py`, new tables)

`AutopilotRecommendation`:
- `id` (int PK), `action_type` (str), `payload` (JSON — executor args),
- `subject` (str — human key like `connection:3` or `mapping:2`; used in `dedupe_key`),
- `dedupe_key` (str, indexed — `f"{action_type}:{subject}"`),
- `rationale` (JSON: `{summary, evidence: [str], trigger: {...}}`), `confidence` (float 0–100),
- `risk` (`low|medium|high`), `reversible` (bool), `reversibility_note` (str),
- `status`: `pending | approved | rejected | superseded | executing | executed | failed`,
- `created_by` (str — `autopilot-engine` or user email for manual reroutes), `created_at`,
- `decided_by`, `decided_at`, `decision_mode` (`human | auto | breaker | rate_limit`),
- `modified_by`, `modified_at` (FR7 modify), `execution_result` (JSON, nullable).
- Index `(status)`, index `(dedupe_key, status)`.

`AutopilotActionLog` (one row per execution attempt / block):
- `id`, `recommendation_id` (FK, nullable — blocks of never-recommended prohibited calls
  have no rec), `action_type`, `payload` (JSON), `mode` (`auto | approved`),
- `outcome` (`success | failure | blocked_prohibited | blocked_rate_limit | blocked_breaker | blocked_policy`),
- `detail` (JSON), `reversibility_note` (str), `actor`, `started_at`, `finished_at`.

## Status machine (enforced in service, task 06)

`pending → approved | rejected | superseded`; `approved → executing → executed | failed`;
auto path: `pending → executing` directly with `decision_mode="auto"`.
Transitions use guarded UPDATE (`WHERE status == expected`) so concurrent approvals/executions
are idempotent — second writer gets 0 rows and 409s (same pattern as the mapping publish race).

## Tests

Covered via tasks 06/10 (transition guards, dedupe uniqueness behavior).
