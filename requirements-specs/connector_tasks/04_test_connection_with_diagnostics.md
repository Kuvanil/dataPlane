# Task #4 — Test Connection with enhanced diagnostics + timeout (CONN-T3)

**TRD reference:** FR4, Performance NFR (≤5s p95), §10 risk table (long-hanging connections).

**Current state:** `backend/app/api/routers/connectors.py` has `POST /connectors/{id}/test` that calls `SchemaService.test_connection(db_conn)`, which returns a boolean. The response is `{"id": ..., "name": ..., "status": "connected"|"failed"}` with no diagnostic detail, no error message, and no timeout. A hanging connection (e.g., unreachable host with TCP timeout defaulting to 30s+ on some drivers) will block the request for that duration.

## Scope

Upgrade Test Connection to return structured diagnostics, enforce a strict timeout, and update the connection's health status.

### Enhanced response shape

Current response:
```json
{"id": 1, "name": "prod-db", "status": "connected"}
```

New response:
```json
{
  "id": 1,
  "name": "prod-db",
  "status": "connected",
  "diagnostics": {
    "reachable": true,
    "authenticated": true,
    "database_accessible": true,
    "version": "PostgreSQL 15.4",
    "latency_ms": 23
  }
}
```

On failure:
```json
{
  "id": 1,
  "name": "prod-db",
  "status": "failed",
  "diagnostics": {
    "reachable": false,
    "authenticated": false,
    "database_accessible": false,
    "version": null,
    "latency_ms": null
  },
  "error": {
    "code": "CONNECTION_TIMEOUT",
    "message": "Connection to host db.example.com:5432 timed out after 5 seconds",
    "detail": "Socket connect timed out (ETIMEDOUT). Verify the host is reachable and the firewall allows traffic on port 5432."
  }
}
```

### Diagnostics breakdown

The test should be structured as a sequence of checks, each reporting its own pass/fail:

1. **Reachability:** Can the host:port be connected to at the TCP level? (Quickest to fail — a DNS failure or firewall block is detected in <1s.)
2. **Authentication:** Does the username/password authenticate successfully?
3. **Database access:** Is the specified database/schema accessible and not in recovery/read-only?
4. **Version:** What version does the server report? (Success even if version detection is unavailable.)
5. **Latency:** How long did the full connection lifecycle take? (Round-trip time in ms.)

Each check is independent — a failure in step 1 means steps 2–5 report `false`/`null` rather than being attempted (to avoid leaking internal state on failed connections).

### Timeout enforcement

Use `concurrent.futures.ThreadPoolExecutor` with a 5-second timeout:

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError

def test_connection(conn: DBConnection) -> TestResult:
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_run_connection_test, conn)
    try:
        return future.result(timeout=5.0)
    except TimeoutError:
        return TestResult(
            status="failed",
            diagnostics=Diagnostics(reachable=False, ...),
            error=TestError(code="CONNECTION_TIMEOUT",
                            message=f"Connection timed out after 5 seconds")
        )
    finally:
        executor.shutdown(wait=False)
```

**Important:** The driver's underlying socket connection may continue running in the thread after the timeout. Close the connector explicitly via `connector.close()` when a timeout occurs. A background thread that's been abandoned can hold a file descriptor — track these and log a warning if the thread doesn't complete within a grace period.

### Implementation in `SchemaService.test_connection`

Refactor `SchemaService.test_connection` (or add a new `test_connection_detailed`) to:

1. Instantiate the connector via the existing `get_connector()` helper.
2. Call `connector.test_connection()` — but enhance `BaseConnector.test_connection()` to return more than a bool.
3. Catch all exceptions and map them to diagnostic codes.

**Scope correction (2026-07-06):** this is NOT a base-class-only change. All 5 concrete
connectors (`postgres.py`, `mysql.py`, `oracle.py`, `sqlite.py`, `jdbc.py`) already define their
own `test_connection(self) -> bool` override — none of them call `super().test_connection()`, so
a new "default" implementation added only to `BaseConnector` would be dead code; every real call
would still hit the old bool-returning override, and this task's own health-check consumer
(Task #5, which calls `result.success`/`result.reachable`) would raise `AttributeError` on a bare
bool. **All 5 connector files' existing `test_connection` methods must be rewritten to return
`TestConnectionResult` as part of this task**, not just `base.py`'s abstract default. Budget
effort accordingly — this touches 6 files (base + 5 connectors), not 1.

### Enhanced `BaseConnector.test_connection`

Change the return type from `bool` to a `TestConnectionResult` dataclass. The snippet below shows
the shared dataclass and one reference implementation (Postgres, adapted from the existing
`test_connection` in `postgres.py`) — the same rewrite pattern (wrap the existing connect+query
logic, classify the caught exception, return `TestConnectionResult` instead of `bool`) applies to
`mysql.py`, `oracle.py`, `sqlite.py`, and `jdbc.py`'s existing overrides individually.

```python
@dataclass
class TestConnectionResult:
    success: bool
    reachable: bool = True
    authenticated: bool = True
    database_accessible: bool = True
    version: str | None = None
    latency_ms: int | None = None
    error_message: str | None = None
    error_code: str | None = None
```

Shared error-classification helper (put in `base.py` as a module-level function or
`BaseConnector` static method — e.g. `BaseConnector._classify_error(error_msg) -> tuple[str, dict]`
— so all 5 rewritten connectors call the same classification logic instead of duplicating the
`if "could not connect" in ...` chain 5 times):
```python
def _classify_and_build_result(error_msg: str) -> TestConnectionResult:
    if "could not connect" in error_msg.lower() or "connection refused" in error_msg.lower():
        return TestConnectionResult(success=False, reachable=False, error_message=error_msg, error_code="CONNECTION_REFUSED")
    if "authentication failed" in error_msg.lower() or "password" in error_msg.lower():
        return TestConnectionResult(success=False, authenticated=False, error_message=error_msg, error_code="AUTH_FAILED")
    # ... more classifications
    return TestConnectionResult(success=False, error_message=error_msg, error_code="UNKNOWN_ERROR")
```

Each connector's existing `test_connection` override is rewritten to this shape (Postgres shown;
apply the same pattern to `mysql.py`/`oracle.py`/`sqlite.py`/`jdbc.py`'s own connect+query calls,
replacing each one's bare `except Exception: return False`):
```python
# postgres.py
def test_connection(self) -> TestConnectionResult:
    try:
        start = time.monotonic()
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        cursor.close()
        latency = int((time.monotonic() - start) * 1000)
        self.close()
        return TestConnectionResult(
            success=True, reachable=True, authenticated=True,
            database_accessible=True, latency_ms=latency,
        )
    except Exception as e:
        return _classify_and_build_result(str(e))
```

Each connector subclass can override to provide more specific diagnostics (e.g., Postgres can report `server_version`, `pg_is_in_recovery`, etc.).

### Health status update

After test, call `connection_service.update_health(db, id, status, error)`:
- Success → `health_status = "healthy"`, `last_test_error = None`
- Failure with reachable=True → `health_status = "degraded"` (the host is up but something is wrong)
- Failure with reachable=False → `health_status = "down"`
- Update `last_tested_at` in all cases.

### Audit emission

Emit `connector_tested` audit event with the result (but never include the password in the audit payload). Include `status`, `latency_ms`, and `error_code` (if any).

## Dependencies

- Task #1 (model upgrade: `health_status`, `last_tested_at`, `last_test_error` columns).

## Edge cases

- **Already-timed-out connection:** If the connection has been sitting idle, it may already be closed or broken. The test should always attempt a fresh connect rather than reusing a cached handle.
- **Concurrent tests:** Two users test the same connection simultaneously. Each gets their own connection handle — no shared state risk. However, if many connections are being tested concurrently (e.g., after a deployment), the thread pool could be overwhelmed. Consider a semaphore or a dedicated connection test queue.
- **Driver-specific timeout settings:** Some drivers have their own connect timeout (e.g., `PGHOST`/`PGCONNECT_TIMEOUT` for psycopg2). Set the driver-level timeout to be slightly less than the 5s global timeout so the driver's own error message (e.g., "timeout expired") is captured, rather than the generic "future timed out" message.
- **Non-secret-only config after Task #2:** After Task #2 lands, `config` will no longer contain the password. The connector drivers need a way to get credentials — either via `secrets_ref` lookup in the service layer before constructing the connector, or by having the service layer inject credentials into the connector at test time.
- **Socket file descriptor leak on timeout:** The `executor.shutdown(wait=False)` + `connector.close()` may not be sufficient if the connector's `connect()` hasn't returned yet and holds a FD. Use `socket.setdefaulttimeout(4.5)` (slightly less than 5s) as a belt-and-suspenders measure.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that a reachable, authenticated connection returns `status: "connected"` with version + latency.
- Test that an unreachable host returns `error_code: "CONNECTION_TIMEOUT"` or `"CONNECTION_REFUSED"`.
- Test that bad credentials return `error_code: "AUTH_FAILED"`.
- Test that a slow connection (stall >5s) returns `error_code: "CONNECTION_TIMEOUT"`.
- Test that health status is updated after test.
- Test that audit event is emitted with the test result.
- Test concurrent test of the same connection doesn't produce errors.
- Test that SQLite (file-based, no credentials) test works and produces reasonable diagnostics.

## Risk

Medium. The timeout mechanism needs careful resource cleanup (socket FDs, threads). The error classification regex is heuristic — the exact error message varies by driver version and locale. The `error_code` field provides a structured fallback for the frontend to display localized error messages regardless of the raw error text. Fall back to `error_code: "UNKNOWN_ERROR"` with the raw message as `error.detail` if classification fails.

Also touches more surface than it first appears: since every connector already overrides
`test_connection`, this task edits 6 files (`base.py` + all 5 connectors), not 1 — treat it as
comparable in size to a small connector-wide refactor, not a single-file diagnostic wrapper.