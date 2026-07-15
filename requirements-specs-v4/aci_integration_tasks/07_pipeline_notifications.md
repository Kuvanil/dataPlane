# Task #7 — Pipeline run/drift notifications via the same notification service

**Reference:** TRD §5 FR6; INDEX.md execution order (independent of #4/#5/#6). Depends on #2, #3.

**Goal:** Reuse Task #5's notify-out plumbing for a second trigger point: `PipelineRun`
(`backend/app/models/pipeline.py:112`) status transitions and drift-impact events, not a second
notification implementation.

## Changes

### 1. `backend/app/services/pipeline_service.py`
- On a `PipelineRun` reaching a terminal `status` (success/failure — confirm exact status values
  in the model before assuming), dispatch the same async notify-out task Task #5 introduced,
  parameterized by pipeline identity and run outcome, if notify-out is enabled for pipeline events
  (same per-type opt-in model, decision #9 — not bundled into a single "all pipeline events"
  toggle; failures and successes should be independently configurable, since most teams want
  failure alerts but not a message for every successful daily run).
- On a drift event flagged as affecting a pipeline (existing "view drift impact" capability per
  `usecase.md`'s Pipelines section) — same notify-out path, distinct message content.

### 2. Tests
- `backend/tests/aci/test_pipeline_notifications.py` — a failed run with failure-notify enabled
  triggers dispatch; a successful run with only failure-notify enabled does not; a drift-impact
  event triggers dispatch when enabled.

## Verify

```bash
cd backend && pytest tests/aci/test_pipeline_notifications.py -v
```
Manually: fail a real pipeline run against a seeded connection with notify-out enabled, confirm a
notification arrives with enough context to act on (which pipeline, which run, the error).

## Risk

- Low — this task is almost entirely reuse of Task #5's dispatch mechanism with a different
  trigger point and message template; the only real design question is the per-event-type opt-in
  granularity (success vs. failure vs. drift-impact, independently configurable).
