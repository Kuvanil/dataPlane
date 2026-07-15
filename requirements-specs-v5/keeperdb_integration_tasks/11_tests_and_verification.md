# Task #11 — Tests + circuit-breaker/outage/no-plaintext-leak verification

**Reference:** TRD §8 Acceptance Criteria (AC5, AC6), §13 Definition of Done. Depends on #1–#8
(everything it verifies must exist first).

**Goal:** Close out the epic with the tests that actually prove the Security and Reliability NFRs
— not optional polish, the actual proof of AC5/AC6.

## Test coverage required

### 1. Circuit-breaker / outage behavior (`backend/tests/secrets/test_ksm_outage_behavior.py`)

- Simulate repeated KSM call failures → circuit breaker opens.
- A call attempted while the breaker is open fails fast (clear error) rather than hanging or
  retrying indefinitely.
- While the breaker is open: connection **metadata** reads (list connections, view non-secret
  `config` fields, connection health status) continue to work unaffected — only credential-
  dependent operations (running a pipeline against that connection, "Test Connection") fail.
- Breaker closes again once KSM calls succeed.

### 2. No-plaintext-leak assertions (`backend/tests/secrets/test_no_plaintext_leakage.py`)

Run across every vault operation (`store`/`retrieve`/`rotate`/`delete`) and every HTTP surface
(`POST`/`GET`/`PUT`/`DELETE` on `/connectors/*`):

- No secret value appears in any HTTP response body, including a 422 validation-error echo of the
  request payload.
- No secret value appears in captured log output (`caplog` across `INFO`/`DEBUG`/`WARNING`/`ERROR`
  levels) for any of the code paths touched by Tasks #3, #4, #5, #6, #8.
- No secret value appears in any audit event payload (Task #8's events specifically).
- Existing 260/260 connector test suite (per `connector_tasks/INDEX.md`) still passes unchanged —
  this epic must not regress FR1/FR2/FR4/FR5/FR7/FR8's already-verified behavior.

### 3. End-to-end backend suite

```bash
cd backend && pytest tests/ -v
```

- Full suite green, including the new `tests/secrets/` modules and the existing
  `tests/connectors/` modules.

## Verify

```bash
cd backend && pytest tests/secrets/ tests/connectors/ -v
```

## Risk

- Medium — this is the task most likely to be under-scoped if rushed, since "the tests pass" is
  easy to claim without the no-plaintext-leak assertions specifically being present. Per this
  repo's own working-loop step 4 ("Don't claim done on type-check alone"), this task's completion
  claim must point to the specific test names asserting AC5/AC6, not just a green `pytest` run.
