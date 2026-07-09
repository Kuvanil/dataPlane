# Bug 02: Engine crashes if registry removes an action type evaluators still reference

- **Severity:** Low
- **File:** `backend/app/services/autopilot_engine.py` lines 218-227
- **Status:** Fixed (2026-07-09)

## Description

`evaluate_all` iterates over draft recommendations returned by evaluators and calls `AutopilotService.upsert_recommendation` for each. If an evaluator references an `action_type` string that is not in the registry — either because a newer evaluator was deployed before its registry entry, or because a registry entry was removed during a deployment with an older evaluator still running — `upsert_recommendation` calls `check_action_allowed` which raises `UnknownActionError`. This propagates up as an unhandled exception from `evaluate_all`, causing the entire evaluation sweep to fail.

## The Problematic Code

```python
@staticmethod
def evaluate_all(db: Session, *, actor: str = ENGINE_ACTOR) -> Dict[str, int]:
    drafts = (
        AutopilotEngine._evaluate_connector_health(db)
        + AutopilotEngine._evaluate_schema_drift(db)
    )
    created_recs = []
    refreshed = 0
    for d in drafts:
        rec, created = AutopilotService.upsert_recommendation(
            db,
            action_type=d["action_type"],  # <--- may not be in registry
            # ...
        )
```

If `d["action_type"]` is `"connector_health_check"` (from an evaluator) but somehow the registry entry was removed, `upsert_recommendation` → `check_action_allowed("connector_health_check")` raises `UnknownActionError`.

## Impact

- A single stale evaluator or a deployment order flip causes the entire `evaluate_all` sweep to fail — no recommendations are created, no triggers are evaluated, and the beat task silently errors.
- The error is caught by the Celery task wrapper (`evaluate_recommendations_task`) and logged, but the `db.rollback()` there discards *all* recommendations created earlier in the same sweep.
- **Test coverage gap:** No test exists with a scenario where an evaluator outputs a draft for an action type not in the registry.

## Suggested Fix

In `evaluate_all`, wrap the `upsert_recommendation` call in a per-draft try/except. Log and skip drafts that fail because the action type is unknown or prohibited:

```python
for d in drafts:
    try:
        rec, created = AutopilotService.upsert_recommendation(
            db, action_type=d["action_type"], ...)
    except (UnknownActionError, ProhibitedActionError) as exc:
        logger.warning("Skipping draft with type '%s': %s", d["action_type"], exc)
        continue
```

This is the same fail-safe principle the rest of the Autopilot follows — "fail-safe defaults to suggest-only on uncertainty" (Reliability NFR) — applied to the engine sweep.

## Detection

Write a test that calls `evaluate_all` after temporarily removing an entry from `ACTION_REGISTRY` (or mocking `check_action_allowed` to raise for a type), and assert that other valid drafts are still created.

## Resolution

**Fixed 2026-07-09.** `evaluate_all` wraps `upsert_recommendation` per draft and skips on `UnknownActionError` / `ProhibitedActionError` / `PayloadValidationError` with a warning log; sweep counts gained a `skipped` field. Regression test: `test_bug02_unknown_draft_type_skipped_not_fatal`.
