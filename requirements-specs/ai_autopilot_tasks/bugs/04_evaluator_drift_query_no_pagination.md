# Bug 04: `_evaluate_schema_drift` loads all drift events without pagination

- **Severity:** Low
- **File:** `backend/app/services/autopilot_engine.py` lines 103-108
- **Status:** Fixed (2026-07-09)

## Description

`_evaluate_schema_drift` loads every `DriftEvent` in the lookback window (default 24 hours) into memory without any pagination or limit. While drift volumes are expected to be manageable for a single connection, a busy system with hundreds of connections could generate tens of thousands of drift events per day. Loading them all into memory at once violates the scalability NFR ("event-driven; able to evaluate many triggers concurrently").

## The Problematic Code

```python
@staticmethod
def _evaluate_schema_drift(db: Session) -> List[Dict[str, Any]]:
    drafts: List[Dict[str, Any]] = []
    since = _now() - timedelta(hours=settings.AUTOPILOT_DRIFT_LOOKBACK_HOURS)
    events = (
        db.query(DriftEvent)
        .filter(DriftEvent.detected_at >= since)
        .order_by(DriftEvent.detected_at.desc())
        .all()  # <--- no limit
    )
    # Newest event per connection wins
    latest_by_conn: Dict[int, DriftEvent] = {}
    for ev in events:
        latest_by_conn.setdefault(ev.connection_id, ev)
```

The query returns **all** drift events in the lookback window, then iterates them all to build `latest_by_conn`. Only `N` events (one per connection with draft mappings) are actually used — the rest are loaded, iterated, and discarded.

## Impact

- **Memory pressure:** On a system with 10,000 drift events in 24 hours, the entire result set is loaded into Python memory.
- **Performance degradation:** The `order_by` is on `detected_at`, which may not be indexed — the query itself becomes slow as the table grows.
- **Scalability ceiling:** The beat evaluates every 2 minutes (`AUTOPILOT_EVALUATE_INTERVAL_MINUTES=2`), so this query runs 720 times per day. Each execution loading an ever-growing drift event table does not scale.
- **Test coverage gap:** No test asserts that the evaluator handles large drift event volumes efficiently.

## Suggested Fix

Replace the `all()` with a windowed query using PostgreSQL's `DISTINCT ON` or a subquery that returns only the latest event per connection within the lookback window. On SQLite (used in tests), `group_by` can be used. On PostgreSQL:

```python
latest = (
    db.query(DriftEvent)
    .filter(DriftEvent.detected_at >= since)
    .distinct(DriftEvent.connection_id)
    .order_by(DriftEvent.connection_id, DriftEvent.detected_at.desc())
    .all()
)
```

Or use a subquery:
```python
latest_ids = (
    db.query(
        DriftEvent.connection_id,
        db.func.max(DriftEvent.id).label('max_id')
    )
    .filter(DriftEvent.detected_at >= since)
    .group_by(DriftEvent.connection_id)
    .subquery()
)
latest = (
    db.query(DriftEvent)
    .join(latest_ids, DriftEvent.id == latest_ids.c.max_id)
    .all()
)
```

This reduces the result set from *all drift events* to *one event per affected connection* — orders of magnitude smaller.

## Detection

The INDEX.md action taxonomy table shows this is a v1 trigger set. As more trigger sources are added, each evaluator should have a documented query limit. No such documentation or guard exists today.

## Resolution

**Fixed 2026-07-09.** Latest-per-connection is now computed in SQL via a `group_by(connection_id)` / `max(id)` subquery joined back to `DriftEvent` — the result set is one row per drifted connection instead of every event in the window; portable across SQLite (tests) and Postgres. Regression test: `test_bug04_only_newest_drift_event_per_connection_is_used`.
