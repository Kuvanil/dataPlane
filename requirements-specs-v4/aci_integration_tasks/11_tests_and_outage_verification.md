# Task #11 — Tests + circuit-breaker/outage-behavior verification

**Reference:** TRD §6 NFR (reliability), AC4. Depends on #1–#9 (needs the real pieces to exist).

## Changes

### 1. Consolidate coverage
- Confirm each task (#2–#9) landed with its own tests per that task's file — this task's job is to
  catch gaps and add end-to-end coverage, not duplicate work already done incrementally.
- End-to-end integration test: a classified `external_action` request → tool discovery → governance
  check → (approval or auto-execution) → audit event, against a mocked ACI backend (not a real
  external SaaS call in CI).

### 2. Outage-behavior verification — the part most likely to be skipped
- Simulate the ACI service being unreachable (mock/point at a dead endpoint) and confirm, for each
  integration point:
  - Task #4's `external_action` intent: the calling AskData request fails clearly and quickly (no
    hang), the rest of AskData (read queries) is completely unaffected.
  - Task #5/#7's notify-out: the underlying Autopilot recommendation / pipeline run's own state is
    completely unaffected by the notification failure (per Task #5's fire-and-forget design) —
    this is the single most important behavior to prove, not just assert in a docstring.
  - The circuit breaker actually opens after the configured failure threshold and fails fast
    (`CircuitBreakerOpen`) rather than continuing to attempt slow, doomed calls.
- This is what AC4 in the TRD actually claims — verify it directly, don't infer it from the
  individual unit tests of each piece in isolation.

### 3. Final verification pass
```bash
cd backend && pytest tests/aci/ tests/askdata/ -v
cd frontend && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```
Manually: bring the stack up with the `aci` service intentionally stopped, exercise an
`external_action` AskData request and trigger an Autopilot recommendation with notify-out enabled;
confirm both fail/degrade gracefully and every other platform feature keeps working normally.

## Verify

Per repo convention: the manual outage walkthrough above is the actual acceptance bar for this
task — a green test suite alone doesn't prove the degradation behavior holds against the real
docker-compose stack.

## Risk

- The outage-behavior verification is exactly the kind of test that's easy to skip because "the
  circuit breaker class already has its own tests" — but this task exists specifically to prove
  it's *wired in correctly at every one of this epic's integration points*, which is a different
  claim than "the class works in isolation." Don't let this get shortchanged.
