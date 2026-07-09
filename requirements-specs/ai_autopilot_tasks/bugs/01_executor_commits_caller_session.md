# Bug 01: `_exec_migration_execute` commits caller's session, breaking transaction atomicity

- **Severity:** Medium
- **File:** `backend/app/services/autopilot_registry.py` line 160
- **Status:** Fixed (2026-07-09)

## Description

`_exec_migration_execute` calls `db.commit()` on line 160 **before** dispatching the Celery task. This is a direct violation of the audit-helper contract documented in `audit_helper.py` which states *"record_audit() does NOT call db.commit() or db.rollback() on the caller's session"* — but the same principle applies to executor callables.

The calling context is `execute_recommendation` in `autopilot_service.py`, which owns the outer transaction boundary and calls `db.commit()` at line 643 after the executor returns. The premature commit in the executor means:

1. If the Celery dispatch succeeds but the caller's subsequent commit fails (e.g., audit write fails), the `AutopilotRun` row is already committed — a partial state is visible to other transactions.
2. If the executor throws *after* the commit (the line is `db.commit()` immediately before `run_autopilot_task.delay(...)`), the outer try/except in `execute_recommendation` will catch the exception and rollback — but the `AutopilotRun` row survives because it was already committed in the sub-call.
3. The comment on lines 158-159 acknowledges the FK dependency and commits *intentionally* to ensure the row exists before Celery picks it up. This is a real tension, but the current implementation trades atomicity for correctness on one specific edge case.

## The Problematic Code

```python
def _exec_migration_execute(db: Session, payload: Dict[str, Any],
                             actor: str) -> Dict[str, Any]:
    # ...
    db.add(AutopilotRun(...))
    # Commit BEFORE dispatch: the worker writes AutopilotLog rows with an FK
    # to this run row and may pick the task up before our transaction lands.
    db.commit()  # <--- line 160: commits caller's session
    run_autopilot_task.delay(...)
    return {"run_id": run_id}
```

## Impact

- **Partial state visibility:** The `AutopilotRun` row is visible to other transactions before the recommendation status is updated to `executed`.
- **Non-atomic multi-step operation:** If the outer transaction fails after the executor returns, the `AutopilotRun` row persists but the recommendation stays in `approved` state — a dangling run with no matching completed execution.
- **Test coverage gap:** The relevant test (`test_queue_executor.py::test_migration_execute_creates_run_and_dispatches`) does not assert that the recommendation status is properly paired with the run, and never simulates a failure after the executor returns.

## Suggested Fix

Use an outbox pattern: write the `AutopilotRun` row and the dispatch intent atomically via an outbox table, and have a separate process commit+dispatch. Alternatively, defer the commit to the caller and accept the FK risk (the worker can retry), or use `db.flush()` + a two-phase commit if the DB supports it. The simplest safe fix:

```python
def _exec_migration_execute(db: Session, payload: Dict[str, Any],
                             actor: str) -> Dict[str, Any]:
    # ...
    db.add(AutopilotRun(...))
    db.flush()  # assigns the ID, but does NOT commit
    # The worker will need to retry if it picks up the task before the outer commit
    run_autopilot_task.delay(...)
    return {"run_id": run_id}
```

This shifts the FK issue to the worker (it may see the run row as `None` for a brief window) but preserves transaction atomicity. The worker already handles missing rows gracefully — it logs and skips.

## Detection

Run a test that forces the outer `execute_recommendation` to fail after `_exec_migration_execute` returns (e.g., monkey-patch `record_audit` to raise) and assert that the `AutopilotRun` row is **not** committed. No such test exists today.

## Resolution

**Fixed 2026-07-09.** `_exec_migration_execute` now only flushes the run row and returns the Celery dispatch as a zero-arg callable under the reserved `DISPATCH_AFTER_COMMIT_KEY`; `execute_recommendation` pops it before persisting `execution_result` and invokes it strictly after its single atomic commit (run row + action log + rec status + audit all land together). A post-commit dispatch failure is surfaced as `executed_dispatch_failed` + an `autopilot_dispatch_failed` audit event, never swallowed. Regression tests: `test_bug01_migration_run_row_rolls_back_with_outer_transaction` (forces a post-executor failure → run row and dispatch both gone) and `test_bug01_dispatch_fires_only_after_commit_and_key_not_persisted` (verifies durability from a second session at dispatch time).
