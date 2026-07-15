# Task #9 — Audit events for every ACI-mediated action

**Reference:** TRD §5 FR8, §6 NFR (auditability). Depends on #3, #4, #5, #7 (the action sites that
need to emit these events).

**Goal:** Every ACI-mediated action — notify-out, an approved `external_action`, a pipeline
notification — emits a distinguishable audit event via this repo's existing `emit_audit_event`
helper (the same pattern every other module in this codebase already follows), so the Audit Trail
remains the single source of truth for "what happened," without needing to cross-reference ACI's
own logs.

## Changes

### 1. Each action site from Tasks #3/#4/#5/#7
- `aci.notify_dispatched` / `aci.notify_failed` — for Task #5/#7's fire-and-forget notifications,
  including which action type, which destination (channel/tool), and outcome.
- `aci.external_action_requested` / `aci.external_action_executed` /
  `aci.external_action_blocked` — for Task #4's intent-routed requests, distinguishing a request
  that was auto-executed (narrow allow-listed case) from one that was queued for approval from one
  that was rejected/blocked by governance.
- All events use `module=aci_integration` (or similar, consistent with this repo's existing
  `module`/`event_type` convention — e.g. `askdata`, `query_studio`) so they're filterable
  independently in the existing Audit Trail UI (`FilterBar.tsx`) without any Audit Trail code
  changes — that UI is already generic over `module`/`event_type`.

### 2. Tests
- `backend/tests/aci/test_audit_events.py` — one test per event type above confirming it's
  recorded with the right `module`/`event_type` and enough payload detail (destination, action
  type, outcome) to reconstruct what happened without consulting ACI's own logs.

## Verify

```bash
cd backend && pytest tests/aci/test_audit_events.py -v
```
Manually: trigger a notify-out and an approved external_action, confirm both appear in
`/dashboard/audit` with `module=aci_integration` and are filterable there.

## Risk

- Low — this task is applying an already-established, repo-wide pattern
  (`emit_audit_event`/`module`/`event_type`) to new call sites, not designing a new audit mechanism.
