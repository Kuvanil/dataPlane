# Task #3 — `KeeperSecretsManagerBackend` adapter

**Reference:** TRD §5 FR2, §12 Technical Notes. Depends on #1 (interface to implement) and #2
(sign-off that KSM is the chosen backend).

**Goal:** A thin adapter wrapping `keeper-secrets-manager-core`, the single chokepoint every KSM
call goes through — mirroring how `aci_client_service.py` (a sibling epic,
`requirements-specs-v4/aci_integration_tasks/02`) is the single chokepoint for ACI calls.

## Changes

### 1. New dependency

- Add `keeper-secrets-manager-core` to `backend/requirements.txt` (PyPI, MIT license, supports
  Python 3.9–3.13 — compatible with this repo's `.venv`).

### 2. New: `backend/app/services/keeper_secrets_manager_backend.py`

- `class KeeperSecretsManagerBackend(SecretManager):` implementing all four interface methods:
  - `store(connection_id, secrets) -> str` — creates a KSM record for the connection's secrets,
    returns `"keeper://{record_uid}"` as the `secrets_ref`.
  - `retrieve(secrets_ref) -> dict` — parses the record UID out of `secrets_ref`, fetches via
    Keeper Notation (`get_notation(f"{record_uid}/field/password")` per field), returns a dict.
  - `rotate(secrets_ref, new_secrets) -> str` — updates the KSM record's field values in place;
    ref does not change (KSM record UID is stable across rotation).
  - `delete(secrets_ref) -> None` — removes/archives the KSM record.
- Initialize the SDK client from `Settings.KSM_CONFIG_PATH` (a mounted config file produced by
  KSM's one-time-token bootstrap — see Task #7) — never a literal token in code or env var.
- Wrap every outbound call in the existing `CircuitBreaker` class
  (`backend/app/core/circuit_breaker.py`) — instantiate one named breaker for KSM calls, following
  the exact pattern already used for Ollama, not a new implementation.
- Retries with exponential backoff on transient failures, per this repo's non-negotiable for
  external calls (`CLAUDE.md`: "External calls (Ollama, DB, HTTP) get retries with exponential
  backoff").
- Log `logger.info("[keeper] ...")` on every call's entry/outcome — **never log the secret value
  itself**, only the record UID / connection id / outcome, matching the `[pipeline] stage=...`
  logging convention.

### 3. Tests

- `backend/tests/secrets/test_keeper_secrets_manager_backend.py` — mock the SDK boundary (not real
  network calls); confirm circuit breaker opens after repeated failures and that a call attempted
  while open fails fast rather than hanging; confirm retries with backoff on a transient failure
  that then succeeds; confirm no test ever asserts against or prints a real-looking secret value
  in a way that could leak into CI logs.

## Verify

```bash
cd backend && pytest tests/secrets/test_keeper_secrets_manager_backend.py -v
```

## Risk

- Low-Medium — bounded wrapper reusing an already-proven pattern (circuit breaker) for a new
  external dependency of a similar shape (HTTP-backed SDK with occasional transient failures) to
  the existing Ollama integration. The one new risk class vs. Ollama: this adapter touches actual
  credential material, so test coverage must explicitly prove nothing leaks into logs (covered
  more thoroughly in Task #11).
