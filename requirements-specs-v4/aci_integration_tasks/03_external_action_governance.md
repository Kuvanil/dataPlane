# Task #3 — Governance registry extension for external-system side effects

**Reference:** TRD §5 FR3, §11 Risks; INDEX.md design decision #2. Depends on #2 (a client service
to gate access to).

**Goal:** Extend `autopilot_registry.py`'s existing allow-list/risk/reversibility pattern to cover
actions that have a side effect on an **external** system — not a new authorization model, the
same one, with new entries.

## Changes

### 1. `backend/app/services/autopilot_registry.py`
- Add a new risk dimension or reuse the existing one — confirm whether `risk`/`reversible` as
  currently modeled cleanly extend to "affects a system outside dataPlane" or whether a new field
  (e.g. `external_side_effect: bool`) is warranted to make this class of action visually/
  structurally distinct in the registry. Prefer extending the existing fields if they genuinely
  fit, over adding a parallel dimension, unless there's a real gap.
- Register initial action types, each with an explicit `auto_capable`/`risk`/`reversible`
  classification:
  - `notify_slack_internal` — posting to **one pre-configured, admin-set internal channel** —
    candidate for `auto_capable=True`, `risk="low"`, `reversible=True` (a message can be deleted/
    ignored; low blast radius by design since the destination is fixed and admin-controlled, not
    user-suppliable).
  - `external_ticket_create` (Jira/Linear/GitHub issue) — `auto_capable=False`, `risk="medium"`,
    approval-only — creates a persistent artifact in a system dataPlane doesn't own.
  - `external_email_send` — `auto_capable=False`, `risk="high"`, approval-only — the highest-blast-
    radius case (could reach an external, non-team recipient) unless explicitly scoped otherwise.
  - Enforce the same import-time assertion this file already has (auto_capable implies
    reversible+low-risk) so a future entry can't accidentally claim both.
- Any action whose destination (channel/recipient/repo) is **user- or LLM-suppliable at request
  time**, rather than a fixed admin-configured value, must not be `auto_capable` regardless of the
  action type's own risk classification — the actual destination is part of the risk, not just the
  action verb.

### 2. Tests
- `backend/tests/aci/test_external_action_governance.py` — confirm the import-time assertion
  rejects a misconfigured `auto_capable=True` + `risk="high"` entry; confirm a user-suppliable-
  destination action is correctly forced to approval-only even if its base action type would
  otherwise qualify as auto-capable.

## Verify

```bash
cd backend && pytest tests/aci/test_external_action_governance.py -v
```

## Risk

- Getting the "fixed destination vs. user-suppliable destination" distinction right is the crux of
  this task — it's the difference between a genuinely low-risk notification and an open channel
  for an agent to message/email anywhere. Don't let this nuance get flattened to "notifications are
  always low-risk" during implementation.
