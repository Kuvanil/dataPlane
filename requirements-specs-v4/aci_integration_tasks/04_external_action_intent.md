# Task #4 — `"external_action"` intent in the Agentic DBA Copilot's intent registry

**Reference:** TRD §5 FR5; INDEX.md confidence note on the v3 dependency. Depends on #2, #3.

**Goal:** Let AskData/Query Workspace requests like "email this data quality report to the team"
or "open a GitHub issue for this schema drift" get recognized and routed to ACI's tool discovery,
instead of falling into NL2SQL's read-query path or the Agentic DBA Copilot's schema-design path.

## Changes

### 1. `backend/app/services/dba_intent_classifier.py`
### (from `requirements-specs-v3/agentic_dba_tasks/01` and `/10`)
- If that epic's extensible intent registry (`agentic_dba_tasks/10`) has landed: register a new
  `"external_action"` entry — matching signals like *email/notify/send/post/open a ticket/create an
  issue/create a PR* — whose handler calls `aci_client_service.search_tools()` to find a matching
  external tool for the request, then (per Task #3's governance) either auto-executes (narrow
  allow-listed case) or queues for approval.
- If that epic's registry **hasn't** landed yet when this task is implemented: add a minimal,
  self-contained keyword-based check directly in `askdata_pipeline_service.ask()` for this specific
  intent (mirroring task #1's original stop-gap pattern in that epic) rather than blocking this
  entire task on v3 landing first — but flag this as technical debt to fold into the real registry
  once it exists, not a permanent parallel classifier.
- On a matched `external_action` request lacking a resolvable target (e.g. "email this" with no
  named recipient/channel, or a tool ACI can't find a match for), ask a clarifying question rather
  than guessing — same principle as the schema-design intent's ambiguity handling.

### 2. Tests
- `backend/tests/askdata/test_external_action_intent.py` — a request like "post this table's PII
  findings to the #data-governance Slack channel" classifies as `external_action` and calls
  `search_tools`, not `NL2SQLService.generate_sql`; an ambiguous request (no target) produces a
  clarifying question.

## Verify

```bash
cd backend && pytest tests/askdata/test_external_action_intent.py -v
```
Manually: ask a plausible external-action request in Query Workspace's Ask mode, confirm it's
recognized and routed correctly rather than either generating a bogus SQL query or silently
executing an ungated external action.

## Risk

- Coordinate explicitly with whoever/whatever state `requirements-specs-v3/agentic_dba_tasks`'s
  registry is in at implementation time — don't build a second permanent classifier if the real one
  already exists, and don't block indefinitely if it doesn't.
