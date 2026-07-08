# Task 10 — Dedicated safety/guardrail test suite

**TRD:** AUTO-T9, §7 AC1–AC4 + checklist, §12 DoD ("dedicated safety/guardrail tests").

`backend/tests/autopilot/test_safety_guardrails.py` — the ACs as executable tests, independent
of the per-task unit tests:

- **AC1** — policy `suggest` for a type ⇒ engine creates the rec, `maybe_auto_execute` never
  dispatches, status stays `pending`, zero action-log rows.
- **AC2** — approval-required rec executes only after `POST .../approve`; before approval the
  executor task invoked directly on a `pending` rec (simulating a stray dispatch) refuses via
  the guarded transition.
- **AC3** — for EVERY autonomy level and for a policy row maliciously set to `auto` directly in
  the DB (bypassing the API's 422): executing a prohibited type (`mapping_publish`,
  `connection_delete`, `credential_change`) is hard-blocked with `outcome=blocked_prohibited`;
  unknown types are default-denied.
- **AC4** — auto-capable type with policy `auto` within limits: trigger ⇒ executed, action log
  row has rationale-bearing rec linked, outcome + reversibility note present, audit trail
  complete (created → executed).
- Rate limits: per-type and global demotion paths; breaker open/close; human approvals exempt.
- Fail-safe: engine exception mid-evaluation leaves no partial recs (transaction), executor
  failure marks rec `failed` and writes a `failure` action-log row (never silently lost).

Frontend (vitest): queue row renders rationale/confidence/reversibility; approve/reject hidden
for viewer; policy select blocks `auto` for non-auto-capable.
