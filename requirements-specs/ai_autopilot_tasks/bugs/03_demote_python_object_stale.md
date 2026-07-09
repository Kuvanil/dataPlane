# Bug 03: `_demote_to_queue` uses `synchronize_session=False` leaving stale Python object

- **Severity:** Low
- **File:** `backend/app/services/autopilot_service.py` lines 471-477
- **Status:** Fixed (2026-07-09)

## Description

`_demote_to_queue` updates the recommendation status back to `pending` (undoing the `executing` transition set by `execute_recommendation`) using `synchronize_session=False`. This means the in-memory `rec` Python object still has `status == "executing"` after the update, even though the database row has `status == "pending"`.

The caller in `execute_recommendation` returns `{"status": "demoted", "reason": ...}` immediately and does not `db.refresh(rec)` before the return, so the stale Python object does not cause a crash. However:

1. **Future reads within the same session** that query `AutopilotRecommendation` will get a stale cached copy from the identity map if they look it up by primary key (`db.query(AutopilotRecommendation).filter(AutopilotRecommendation.id == rec.id).first()` returns the stale in-memory object). This could affect downstream processing if another part of the same transaction reads the recommendation.
2. **The `record_audit` call** at line 479 writes the `recommendation_id` — this is fine, it reads `rec.id` which hasn't changed.
3. **If `evaluate_all` is called again in the same session** (unlikely in production but possible in tests), it would see the stale `executing` status in the identity map and skip the recommendation incorrectly.

## The Problematic Code

```python
@staticmethod
def _demote_to_queue(db: Session, rec: AutopilotRecommendation, *,
                     outcome: str, event_type: str, reason: str) -> Dict[str, Any]:
    started = _now()
    AutopilotService._log_action(...)
    db.query(AutopilotRecommendation).filter(
        AutopilotRecommendation.id == rec.id,
        AutopilotRecommendation.status == "executing",
    ).update(
        {"status": "pending", "decided_by": None, "decided_at": None,
         "decision_mode": None},
        synchronize_session=False,  # <--- stale object
    )
    # ...
    db.commit()
    return {"status": "demoted", "reason": reason}
```

## Impact

- **Low** in production because `_demote_to_queue` is always the terminal operation in the auto-execution path — no subsequent code in the same transaction reads the recommendation's status after the demotion.
- **Medium in tests** if a test re-uses the session after a demotion without calling `db.refresh(rec)` or `db.expire(rec)`.

## Suggested Fix

Change `synchronize_session=False` to `synchronize_session='evaluate'` (or `True`) so SQLAlchemy refreshes the `rec` object in place:

```python
.update(
    {"status": "pending", "decided_by": None, "decided_at": None,
     "decision_mode": None},
    synchronize_session='evaluate',
)
```

Alternatively, call `db.refresh(rec)` after the commit before returning.

## Detection

Write a test that demotes a recommendation (via rate limit or breaker) and then reads `rec.status` from the same session without refreshing — it should be `"pending"`, not `"executing"`.

## Resolution

**Fixed 2026-07-09.** `_demote_to_queue` now `db.refresh(rec)` after its commit; the same identity-map staleness class was also fixed in `execute_recommendation`'s final executed/failed update, the prohibited-block path (both refresh after commit), and `supersede` (`db.expire(rec)` inside the caller's transaction). Regression test: `test_bug03_demoted_rec_object_is_fresh_without_manual_refresh`.
