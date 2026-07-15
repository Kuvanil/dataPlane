# Task #5 — Notify-out fan-out for Autopilot + Agentic DBA Copilot approval queues

**Reference:** TRD §5 FR4; INDEX.md design decisions #1 (notify-out only, no bidirectional
approval), #5 (async), #9 (opt-in, not blanket). Depends on #2, #3.

**Goal:** When an Autopilot recommendation or an Agentic DBA Copilot `SchemaDesignPlan`
(`requirements-specs-v3`) enters an approval-pending state, optionally post a notification to an
external tool (Slack, initially) linking back to dataPlane's own approval UI. The approval decision
itself still happens inside dataPlane — this task only closes the "how do I find out there's
something to review" gap.

## Changes

### 1. `backend/app/services/autopilot_service.py`
- On `upsert_recommendation` transitioning a recommendation to pending-approval (existing code
  path, per prior epics' documented behavior): if notify-out is enabled for that action type
  (per-type opt-in, decision #9 — not a global switch), dispatch an async Celery task calling
  `aci_client_service.execute_tool("notify_slack_internal", ...)` (Task #3's registered,
  auto-capable action) with a message linking back to dataPlane's approval-queue UI.
- Do this as a **fire-and-forget** dispatch — a notification failure must never block or fail the
  underlying recommendation/approval-queue write.

### 2. Agentic DBA Copilot integration (`requirements-specs-v3/agentic_dba_tasks/06`'s approve
   endpoint, once that epic lands)
- Same pattern: plan entering `"pending_approval"` (or whatever status that epic settles on)
  triggers the same notify-out path, reusing this task's plumbing rather than a second
  implementation.

### 3. Per-action-type opt-in configuration
- A simple admin-settable flag per action type (e.g. in the same place Autopilot's existing policy
  settings live) — "notify on this recommendation type: yes/no" — not a single blanket toggle.

### 4. Tests
- `backend/tests/aci/test_notify_out.py` — recommendation reaching pending-approval with
  notify-out enabled triggers the async dispatch; with it disabled, doesn't; a simulated ACI
  failure during notify-out doesn't affect the recommendation's own persisted state.

## Verify

```bash
cd backend && pytest tests/aci/test_notify_out.py -v
```
Manually: enable notify-out for one Autopilot recommendation type, trigger one, confirm a Slack
message arrives linking back to the real approval UI.

## Risk

- Low-medium — the main risk is coupling notification failure to the underlying business
  operation's success; the fire-and-forget async design in this task exists specifically to
  prevent that coupling — verify it explicitly in tests, not just by code inspection.
