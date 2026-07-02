# Task #5 — Remove `commit()`/`rollback()` from `record_audit` (atomicity fix)

**Reviewer finding:** §11.6 (CRITICAL). `record_audit`
(`backend/app/services/audit_helper.py`) shares the caller's session and
calls `db.commit()` and `db.rollback()` on it. This breaks transactional
atomicity in two ways:

1. **Silent data loss on audit-write failure.** Every service method
   follows the pattern `db.add(x); db.flush(); record_audit(...); db.commit()`.
   If `record_audit`'s internal `commit()` succeeds, the caller's `x` is
   persisted by that commit (not by the later `db.commit()`, which is now
   a no-op on an empty transaction). If `record_audit`'s commit fails for
   any reason (constraint, transient blip), its `except` calls
   `db.rollback()` — discarding the already-flushed `x` that was never
   independently committed. The caller's later `db.refresh(x)` then fails
   with an `InvalidRequestError`/`ObjectDeletedError`, and the router may
   serialize and return HTTP 201 with a mapping that doesn't exist.

2. **Non-atomic multi-step operations.** `accept_suggestion`
   (`mapping_service.py:286-343`) calls `_add_edge_internal`, whose
   `record_audit` call commits the new `FieldMapping` row **before**
   `accept_suggestion` continues to set `edge.ai_confidence`, `sug.status =
   "accepted"`, etc. A crash between those two commits leaves a
   `FieldMapping` row persisted with `ai_confidence=None` and an
   `AISuggestion` still `pending` — inconsistent, hand-recoverable-only state.

## Changes

### 1. `backend/app/services/audit_helper.py`
- Remove `db.commit()` and `db.rollback()` from `record_audit`.
- Replace with `db.flush()` to surface constraint errors immediately
  without committing.
- The `except` branch logs the failure but does **not** rollback — that
  would discard the caller's pending business work too.
- Document the new contract: callers own the transaction boundary.

### 2. `backend/app/services/mapping_service.py`
- Audit the ~12 `record_audit(...) ; db.commit()` call sites. After the
  helper change, these remain correct: the caller's final `db.commit()`
  persists both the business object and the audit row in one atomic
  transaction. No code change needed at call sites beyond verifying
  that each mutating method has exactly one `db.commit()`.

### 3. `backend/tests/mapping/test_audit_atomicity.py` (NEW)
- `test_record_audit_does_not_commit`: call `record_audit` with an audit
  payload, then verify the row is NOT yet visible via a fresh query
  (caller's commit hasn't run).
- `test_record_audit_failure_does_not_rollback_caller`: induce an audit
  failure (e.g. by passing a payload that violates a constraint or by
  closing the session mid-call), then verify the caller's pending
  business object is still committable.
- `test_caller_commit_persists_business_and_audit_atomically`: call a
  service method that performs both a business write and a record_audit,
  then verify exactly ONE commit landed and BOTH rows exist.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 87+/87+. The existing 87 tests exercise the call sites in
mapping_service.py and should pass unchanged because the pattern
`db.flush(); record_audit(...); db.commit()` is preserved — only the
internals of `record_audit` change.

## Risk

- **Any caller that relied on `record_audit` committing the audit row
  independently** will silently lose the audit row if it never calls
  `db.commit()` itself. Audit of all `record_audit` callers: every one
  in `mapping_service.py` follows the `db.flush(); record_audit(...);
  db.commit()` pattern (verified during this fix). The new test
  `test_record_audit_does_not_commit` guards against future callers
  breaking this invariant.
- **Exception handling at call sites.** If a caller calls `record_audit`
  and the audit insert raises (e.g. `IntegrityError`), the current code
  used to swallow it. The new code still swallows it (no rollback) — the
  caller's transaction is unaffected, and the missing audit row is logged
  but does not block the business operation. Acceptable trade-off: a
  missing audit row is better than a half-committed business object.
  If audit durability becomes a hard requirement, switch to an outbox
  pattern (separate session) — out of scope for this fix.
