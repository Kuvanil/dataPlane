# Task #2 — `aci_client_service.py` backend wrapper

**Reference:** TRD §5 FR1/FR2, §12 Technical Notes; INDEX.md design decisions #4, #5.
Depends on #1 (a reachable ACI instance to wrap).

**Goal:** A thin, well-bounded backend service wrapping ACI's Python SDK — the single chokepoint
every other task in this epic calls through, mirroring how `frontend/src/lib/api.ts` is this
repo's single chokepoint for HTTP calls on the frontend side.

## Changes

### 1. New: `backend/app/services/aci_client_service.py`
- `search_tools(query: str, linked_account_id: str | None) -> list[ToolMatch]` — wraps ACI's
  meta-function tool discovery.
- `execute_tool(tool_name: str, params: dict, linked_account_id: str) -> ToolResult` — wraps
  ACI's execute meta-function.
- `list_linked_accounts() -> list[LinkedAccount]` — for Task #8's frontend surface.
- Wrap every outbound call in the existing `CircuitBreaker` class
  (`backend/app/core/circuit_breaker.py`) — instantiate one named breaker for ACI calls, following
  the exact pattern already used for Ollama, not a new implementation.
- Read `ACI_BASE_URL`/`ACI_API_KEY` from `Settings` (Task #1) — never construct these from
  hardcoded values.
- Retries with exponential backoff on transient failures, per this repo's non-negotiable for
  external calls (`CLAUDE.md`: "External calls (Ollama, DB, HTTP) get retries with exponential
  backoff").
- Log `logger.info("[aci] ...")` on every call's entry/outcome, matching the `[pipeline] stage=...`
  logging convention already established elsewhere in this codebase for external/pipeline calls.

### 2. Tests
- `backend/tests/aci/test_aci_client_service.py` — mock the SDK boundary (not real network calls);
  confirm circuit breaker opens after repeated failures and that a call attempted while open fails
  fast with `CircuitBreakerOpen` rather than hanging or retrying indefinitely; confirm retries with
  backoff on a transient failure that then succeeds.

## Verify

```bash
cd backend && pytest tests/aci/test_aci_client_service.py -v
```

## Risk

- Low — this is a bounded wrapper reusing an already-proven pattern (circuit breaker) for a new
  external dependency of the same shape (HTTP API with occasional transient failures) as the
  existing Ollama integration.
