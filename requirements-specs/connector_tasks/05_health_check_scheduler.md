# Task #5 — Health check scheduler + status tracking (CONN-T4)

**TRD reference:** FR5, Scalability NFR (hundreds of connections per tenant), Reliability NFR (retry/backoff), §10 risk table (long-hanging connections).

**Current state:** There is no health check system. Connection health is only evaluated when a user manually triggers "Test Connection" via `POST /connectors/{id}/test`. There is no periodic background check, no status aggregation, and no way to distinguish "never tested" from "previously healthy but now unreachable." The `DBConnection` model has no `health_status` column yet (see Task #1).

## Scope

Build a periodic health check scheduler that tests all non-deleted connections and updates their health status.

### Celery periodic task

Add a new task in `backend/app/tasks/connector_tasks.py` (new file, mirroring `ai_tasks.py`):

```python
from celery import shared_task
from app.core.celery_app import celery_app

@celery_app.task(bind=True, max_retries=2, default_retry_delay=60)
def run_health_check_for_connection(self, connection_id: int):
    """Test a single connection and update its health status."""
    from app.core.database import SessionLocal
    from app.models.connection import DBConnection
    from app.services.connection_service import ConnectionService
    from app.services.connector_catalog import get_secret_fields_for_type

    db = SessionLocal()
    try:
        conn = db.query(DBConnection).filter(
            DBConnection.id == connection_id,
            DBConnection.is_deleted == False
        ).first()
        if not conn:
            return {"status": "skipped", "reason": "connection deleted or not found"}

        # Build full config (including decrypted secrets)
        config = dict(conn.config or {})
        if conn.secrets_ref:
            from app.services.secret_manager import get_secret_manager
            secrets = get_secret_manager().retrieve(conn.secrets_ref)
            config.update(secrets)

        # Test using Task #4's enhanced diagnostics. `get_connector(connection)`
        # (backend/app/services/schema_service.py) takes the whole DBConnection
        # ORM object and reads `.type`/`.config` itself -- it does NOT accept a
        # bare type string, and there is no separate class to instantiate
        # (an earlier draft called `get_connector(conn.type)(config)`, which
        # raises immediately since `.type.lower()` would run on a plain str).
        # Swap `conn.config` to the decrypted, merged config in-memory only
        # (never committed) so get_connector's real signature can be reused
        # without ever persisting secrets into the `config` JSON column.
        from app.services.schema_service import get_connector
        original_config = conn.config
        try:
            conn.config = config
            connector = get_connector(conn)
            result = connector.test_connection()
        finally:
            conn.config = original_config

        connection_service = ConnectionService()
        if result.success:
            connection_service.update_health(db, connection_id, "healthy")
        elif result.reachable:
            connection_service.update_health(db, connection_id, "degraded", result.error_message)
        else:
            connection_service.update_health(db, connection_id, "down", result.error_message)

        db.commit()
        return {
            "status": "completed",
            "connection_id": connection_id,
            "success": result.success,
        }
    except Exception as e:
        db.rollback()
        try:
            ConnectionService().update_health(db, connection_id, "down", str(e))
            db.commit()
        except Exception:
            db.rollback()
        raise self.retry(exc=e)
    finally:
        db.close()
```

### Celery beat schedule

Add to `backend/app/core/celery_app.py`:

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "health-check-all-connections": {
        "task": "app.tasks.connector_tasks.run_all_health_checks",
        "schedule": crontab(minute="*/5"),  # Every 5 minutes
    },
}
```

The `run_all_health_checks` task queries all non-deleted connections and dispatches one `run_health_check_for_connection` task per connection. This allows parallel execution across multiple Celery workers:

```python
@celery_app.task
def run_all_health_checks():
    """Dispatch one health check task per non-deleted connection."""
    from app.core.database import SessionLocal
    from app.models.connection import DBConnection

    db = SessionLocal()
    try:
        connection_ids = [
            row.id for row in
            db.query(DBConnection.id).filter(DBConnection.is_deleted == False).all()
        ]
    finally:
        db.close()

    for cid in connection_ids:
        run_health_check_for_connection.delay(cid)

    return {"dispatched": len(connection_ids)}
```

### Retry with exponential backoff

Each connection check gets `max_retries=3` with exponential backoff (60s, 120s, 240s). If all retries fail, the connection's health status is set to `"down"` and the error is logged. The connection won't be retried until the next scheduled run (5 minutes later), but it will be retried within that run's retry window.

A connection that has been `"down"` for 3 consecutive checks should NOT trigger an alert escalation — that's out of scope (owned by Monitoring). The health status simply reflects the last known state.

### Status aggregation endpoint

Add `GET /connectors/health-summary` that returns an aggregate view:

```json
{
  "total": 12,
  "healthy": 8,
  "degraded": 2,
  "down": 1,
  "unknown": 1,
  "last_scan_at": "2026-07-06T18:30:00Z"
}
```

### Rate limiting / concurrent check gating

With hundreds of connections, spawning a Celery task per connection every 5 minutes puts load on both Celery and the target databases. Add a `MAX_CONCURRENT_HEALTH_CHECKS` setting (default: 10). The `run_all_health_checks` task should respect this by dispatching in batches or by using a Celery rate limit:

```python
@celery_app.task(rate_limit="10/m")
def run_health_check_for_connection(self, connection_id: int):
    ...
```

This limits to 10 connection checks per minute regardless of the total number of connections. With 100 connections, the full cycle takes ~10 minutes.

## Dependencies

- Task #1 (model upgrade: `health_status`, `last_tested_at`, `last_test_error` columns).
- Task #4 (enhanced test diagnostics: `test_connection()` returning structured result instead of bare bool).
- Task #2 (secret manager: `secrets_ref` must be resolvable at health-check time).

## Edge cases

- **Celery worker not running:** If Celery beat/worker isn't running, health checks simply don't happen. The `status` stays at whatever it was last set to. This is acceptable — health checks are best-effort, not critical infrastructure.
- **Connection deleted mid-check:** A connection could be deleted (hard or soft) between the dispatch and execution of its health check. The task handles this by re-querying and returning "skipped" if not found.
- **Connection secrets rotated mid-check:** If a user rotates credentials moments before the health check uses them, the old credentials could cause a false "down" status. Mitigation: Task #8's rotation should mark the connection as "testing" during rotation, and the health check should skip connections in "testing" status. Alternatively, rely on the fact that the next check (5 min later) will correct the status.
- **Backoff thundering herd:** After a deployment/restart where all connections are rediscovered simultaneously, the first health-check cycle sees all connections at `health_status="unknown"` and dispatches tasks for all of them. The rate limit (`10/m`) prevents the thundering herd problem.
- **Database connection pool exhaustion:** Each health check opens a Celery task with its own DB session. With the rate limit of 10/m, at most 10 simultaneous DB sessions are held by health checks. This is acceptable.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that `run_all_health_checks` dispatches one task per non-deleted connection.
- Test that a healthy connection results in `health_status="healthy"`.
- Test that an unreachable host results in `health_status="down"` after retries exhausted.
- Test that a connection deleted mid-check is handled gracefully (status stays as-is, no error).
- Test that `GET /connectors/health-summary` returns the correct aggregate counts.
- Test that the rate limit is respected (if using a test Celery config).
- Test that a connection with `secrets_ref` is checked correctly (secrets are decrypted before test).

## Risk

Low-medium. The health check is a read-only operation that doesn't affect any data. The main risk is resource consumption (Celery task queue, DB connections, target DB load) at scale, mitigated by rate limiting. A false "down" status due to transient network blip is acceptable — the next scheduled run corrects it within 5 minutes.