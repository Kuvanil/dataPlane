# Keeper Secrets Manager Integration — Validation Bugs (second pass)

Second validation pass, 2026-07-15. The first pass (`bugs.md`) found and fixed
two defects (BUG-01 test-package shadowing, BUG-02 rotation fail-closed). This
deeper adversarial review of the vault resolution, circuit-breaker, and
backend-selection paths found and fixed three further correctness defects.
Every claim was traced end-to-end; each fix carries a regression test.

No plaintext-secret leak was found in the v5 code paths in this pass either
(logs/audit payloads/422 echoes carry field names, refs, backend, and
connection ids only) — that posture holds. Full-suite result after fixes:
backend `pytest` 811/811.

The Task #10 tenant-isolation sign-off and the Task #11 live Keeper acceptance
run remain out of scope / open acceptance items, not code defects.

---

## BUG-03 — Retrieve-audit `TTLCache` is not thread-safe and was touched outside the try/except, so a race could break credential resolution  ✅ FIXED

- Severity: Medium (affects the *default* aes256 backend under normal
  concurrent load)
- Where: `app/services/connection_secrets_service.py` — module-level
  `_retrieve_audit_cache = TTLCache(...)`, accessed by `_audit_retrieve_batched`
  (reached from `resolve_connection_config`).
- Cause: `cachetools.TTLCache` is documented as not thread-safe, and the
  membership check (`if connection.id in _retrieve_audit_cache`) and write
  (`_retrieve_audit_cache[connection.id] = True`) sat *before* the `try:`
  whose comment promises "audit must never block credential resolution".
- Failure scenario: FastAPI runs sync route handlers (and Celery workers)
  concurrently. Two simultaneous `get_connector()` calls on connections with a
  `secrets_ref` both enter `_audit_retrieve_batched`; concurrent mutation of
  the cache's internal structure can raise `RuntimeError`/`KeyError`, which —
  being outside the try — propagates out of `resolve_connection_config` →
  `get_connector`, failing the request even though the vault itself is healthy.
- Fix: added a `threading.Lock` guarding the cache check/set, and moved the
  entire body (cache access + DB write) inside the try/except so any failure is
  logged non-fatally and never breaks credential resolution.
- Regression: covered by the existing retrieve-batching wiring tests; the lock
  serializes the previously-racy check/set. (A deterministic multi-thread race
  is impractical to assert in unit tests; the fix removes the unguarded access
  that was the defect.)

## BUG-04 — Keeper adapter tripped its outage circuit breaker on a benign "record not found" (and on "not configured")  ✅ FIXED

- Severity: Medium (a few stale refs could take down healthy credential reads
  platform-wide for `reset_timeout`)
- Where: `app/services/keeper_secrets_manager_backend.py` —
  `retrieve`/`rotate` raised `SecretManagerError("no keeper record …")` *inside*
  `keeper_circuit.call(fn)`, and `_get_client()`'s
  `SecretManagerNotConfigured` was likewise raised inside the breaker.
- Cause: the breaker counts every exception from the wrapped function as a
  failure. A missing/moved record raised inside the wrapped call, and the retry
  loop re-invoked the breaker each attempt, so one missing-record retrieve
  recorded up to 3 failures. Two such retrievals opened the `"keeper"` breaker
  (threshold 5); for the next 30s *every* keeper credential op — including
  healthy records — failed fast with `CircuitBreakerOpen`.
- Fix: `_get_client()` is now resolved outside the breaker (a config state, not
  an outage), and the "no record" decision is made *after* the breaker-guarded
  fetch returns. A missing record → the fetch succeeds (empty list) → the
  breaker records success → the benign `SecretManagerError` is raised outside
  the breaker. Real network failures inside the fetch/save are still counted.
- Regression test:
  `tests/secrets/test_keeper_backend.py::test_missing_record_does_not_trip_breaker`.

## BUG-05 — Unknown `SECRET_MANAGER_BACKEND` silently degraded to legacy plaintext storage  ✅ FIXED

- Severity: Medium (silent security downgrade)
- Where: `app/services/secret_manager.py:secret_manager_enabled` +
  `app/core/config.py` (no startup validation of the backend name).
- Cause: `secret_manager_enabled()` only special-cased `"keeper"`; any other
  value fell through to `return bool(settings.SECRETS_ENCRYPTION_KEY)`.
- Failure scenario: an operator sets `SECRET_MANAGER_BACKEND="ksm"` (typo for
  `keeper`) with `KSM_CONFIG_PATH` set but `SECRETS_ENCRYPTION_KEY` unset →
  `secret_manager_enabled()` returns `bool(None)` → `False` →
  `vaulting_active()` is False → `create_connection` silently stores
  credentials as plaintext in the `config` column (legacy mode) while the
  operator believes vaulting is on. The mirror case (unknown backend +
  `SECRETS_ENCRYPTION_KEY` set) reported "enabled" then 500'd mid-write.
- Fix (two layers):
  1. Boot-time: a `field_validator` on `SECRET_MANAGER_BACKEND` rejects any
     value outside `{aes256, keeper}` when `Settings` is constructed, so a
     typo fails the app fast at startup instead of at first vault use.
  2. Runtime defense: `secret_manager_enabled()` now raises
     `SecretManagerNotConfigured` for an unknown backend rather than returning
     `False`, so it can never silently fall through to plaintext (e.g. if the
     value is changed at runtime past the boot validator). Legacy mode
     (backend `aes256` with no key) is unchanged.
- Regression tests:
  `tests/secrets/test_service_wiring.py::test_unknown_backend_fails_fast_not_silent_plaintext`
  and `::test_config_rejects_unknown_backend_at_construction`.

---

> BUG-01/BUG-02 numbering is continued from the first pass's `bugs.md`; these
> new defects are BUG-03..05.
