# Task 05 — Recommendation engine: trigger evaluators + beat + event hooks (FR2)

**TRD:** FR2, AUTO-T2, Performance NFR (rec ≤10s after trigger), §10 prompt-injection mitigation.

## New file `backend/app/services/autopilot_engine.py`

Evaluators are pure functions over DB state → list of recommendation drafts. **Rationale is
deterministic, templated from metadata — never from data content, never from an LLM**
(INDEX decision 2).

Trigger set v1 (grounded in tables that exist today):

1. **Drift** — for each `DriftEvent` in the last 24h (env-configurable) on connection C:
   - for every **draft** mapping whose `source_id`/`target_id` == C →
     `mapping_suggestions_refresh{mapping_id}`; rationale cites the drift event id, table/column
     deltas, and the mapping's unmapped-column count; confidence scaled by how directly the
     drifted tables intersect the mapping's target tables (simple heuristic, documented inline).
2. **Connector health** — for each connection with `health_status in (degraded, down)`:
   - `connector_health_check{connection_id}` (re-test to confirm recovery/persistents);
     rationale cites `last_tested_at`, `last_test_error`; confidence fixed 90 (mechanical retest).
   - if `down` for the *source or target of any draft mapping or pipeline* → mention in evidence.

Dedupe/supersede (INDEX decision 7): before insert, look up open (`pending`) rec by `dedupe_key` —
refresh `rationale`/`confidence`/`created_at` in place instead of inserting. After evaluation,
supersede open recs whose trigger cleared (connection healthy again; mapping no longer draft).

`evaluate_all(db) -> {created, refreshed, superseded}` — single entrypoint.

## Celery (`backend/app/tasks/autopilot_tasks.py`, new file)

- `evaluate_recommendations_task` — calls `evaluate_all`; registered in beat every
  `AUTOPILOT_EVALUATE_INTERVAL_MINUTES` (default 2). `logger.info("[pipeline] stage=autopilot_evaluate ...")`.
- Inline hooks for the ≤10s NFR: `check_schema_drift_task` (after drift detected) and
  `run_health_check_for_connection` (after a non-healthy result) dispatch
  `evaluate_recommendations_task.delay()` — 2 lines each, guarded so failures never break the host task.

## API

`POST /api/v1/autopilot/evaluate` — `require_role("admin","analyst")`; runs synchronously (fast,
DB-only) and returns the counts. Audit `autopilot_evaluated`.

## Tests

Drift on a draft mapping's source → rec created with rationale citing the drift; re-evaluate →
refreshed not duplicated; connection back to healthy → health rec superseded; published mapping →
no suggestions-refresh rec.
