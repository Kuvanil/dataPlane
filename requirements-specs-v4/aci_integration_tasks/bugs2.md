# ACI External Tools Integration — Validation Bugs (second pass)

Second validation pass, 2026-07-15. The first pass (`bugs.md`) found no v4
defects in its automated sweep; this deeper adversarial review of the circuit
breaker, notify-out, external-action, and governance paths found and fixed four
correctness defects and documents one lower-severity issue. Every claim was
traced end-to-end; each code fix carries a regression test where a test harness
exists. Full-suite result after fixes: backend `pytest` 811/811.

The Task #10 tenant-isolation sign-off and the Task #11 live Slack/ACI
walkthrough remain out of scope / open acceptance items, not code defects.

---

## BUG-01 — `AciNotConfigured` counted as a circuit-breaker failure → clear "not configured" error degraded into a misleading "circuit open"  ✅ FIXED

- Severity: Medium (violates guarantee #7 — unset key must give a clear error)
- Where: `app/services/aci_client_service.py` — `_get_client()` (the config
  check that raises `AciNotConfigured`) ran *inside* `_do`, which runs inside
  `aci_circuit.call(fn)`; the breaker's `except Exception: record_failure()`
  counted it.
- Failure scenario: ACI simply isn't configured. The integrations page (GET
  `/linked-accounts`) or an askdata external-action request is hit 5 times;
  each correctly returns "…is not configured (ACI_API_KEY unset)". On the 6th
  call the breaker (threshold 5) is OPEN, so the next call raises
  `CircuitBreakerOpen` → the message flips to "ACI service unreachable (circuit
  open) — try again shortly", which is false (it will never work until
  configured). Amplifier: the shared `aci` breaker is polluted *before* ACI is
  ever configured, so the first real calls after an admin sets `ACI_API_KEY`
  can fail-fast for up to `reset_timeout` (30s).
- Fix: `_get_client()` is now resolved **outside** the breaker in
  `search_tools`/`execute_tool`/`list_linked_accounts`. `AciNotConfigured` is
  raised before the breaker is involved, so a configuration state never counts
  as an outage. The actual SDK call remains breaker-guarded.
- Regression test:
  `tests/aci/test_aci_client_service.py::test_unconfigured_calls_do_not_pollute_breaker`.

## BUG-02 — External-action target resolution mis-routed ticket requests containing an email or an issue/PR number  ✅ FIXED

- Severity: Medium (structurally-wrong queued recommendation; mitigated, not
  eliminated, by the human approval gate)
- Where: `app/services/askdata_pipeline_service.py:_resolve_external_target`.
- Cause: precedence was email → `#channel` → ticket-words, and `_CHANNEL_RE`
  (`#[\w-]+`) matched bare numbers.
  - "open a Jira ticket for the outage, cc bob@corp.com" → email matched first
    → queued `external_email_send` to `bob@corp.com` instead of a ticket.
  - "open a GitHub issue for bug #500" → `#500` matched as a channel → queued
    `external_message_send` to `#500` instead of `external_ticket_create`.
- Fix: an explicit ticket request (a ticketing noun **and** a creation verb,
  via `_is_ticket_request`) now takes precedence over email/channel, so
  "open a jira ticket … cc …" and "open a github issue for bug #500" both route
  to `external_ticket_create`. `_CHANNEL_RE` now requires a letter-led name
  (`#[A-Za-z][\w-]*`) so a bare `#500` is never treated as a Slack channel. An
  incidental ticketing word without a creation verb ("email bob@x.com about the
  issue") still routes to email — the change targets explicit ticket requests
  only.
- Regression tests:
  `tests/askdata/test_external_action_intent.py::test_external_target_resolution_precedence`
  (5 cases) and `::test_bare_issue_number_is_not_a_channel`.

## BUG-03 — GET `/integrations/notification-settings` was not admin-gated  ✅ FIXED

- Severity: Low (info disclosure; contract #6 says GET and PUT are both
  admin-gated)
- Where: `app/api/routers/integrations.py:get_notification_settings` depended
  on `get_current_user` (any authenticated user) while the PUT correctly used
  `require_role("admin")`.
- Failure scenario: a `viewer`/`analyst` could read the full notify-out
  configuration (which event keys are enabled and who last changed them).
- Fix: GET now uses `require_role("admin")`, matching the adjacent PUT.
- Verification: one-line dependency swap identical to the PUT handler
  immediately below it, which is exercised by the shared `require_role`
  dependency used throughout the codebase. (The ACI test conftest has no
  role-based `TestClient` fixtures, so no bespoke HTTP harness was added for
  this one-liner.)

## BUG-04 — `notify_out_task` could raise out of its own `except` on a poisoned session  ✅ FIXED

- Severity: Low (edge; degrades acceptably — Celery isolates the task and it's
  single-shot — but loses the "always audit both outcomes" guarantee)
- Where: `app/tasks/aci_tasks.py:notify_out_task`.
- Cause: in the success branch, if `db.commit()` raised (connection dropped
  mid-commit), control entered `except Exception`, which called `_audit_failure`
  then a second `db.commit()` on the now-poisoned session — that second commit
  raised again, uncaught, so no audit row was written.
- Fix: both `except` handlers now `db.rollback()` before auditing, so the
  session is clean for the failure-audit commit.

---

## Documented (not fixed this pass)

### BUG-05 — Notify-out is dispatched before the caller commits in the recommendation path  (Medium-Low)

- Where: `app/services/autopilot_service.py:upsert_recommendation` calls
  `dispatch_notify_out` after `db.flush()` but the actual commit happens later
  in each caller (askdata router, autopilot engine, autopilot router).
- Behavior: the notify worker runs on its own session and can post the
  "recommendation pending approval — #N" Slack message before (or when) the
  caller's transaction rolls back, leaving a Slack message that links to a
  recommendation that doesn't exist. This does **not** corrupt recommendation
  state (guarantee #1 holds — the state is simply never created); the defect is
  a spurious/dangling external notification, and only when notify-out is opted
  in (OFF by default) and the caller's commit fails.
- Why deferred: the correct fix is after-commit dispatch (the repo already has
  a `DISPATCH_AFTER_COMMIT_KEY` mechanism in `autopilot_registry.py`), which
  means moving the dispatch out of `upsert_recommendation` into each of its
  three callers' post-commit paths — a multi-site change with behavioral
  nuance (dispatch only when `created`), disproportionate to a rare
  opt-in-only misfire. Contrast the pipeline hook
  (`pipeline_executor._update_run_status`), which already dispatches after its
  commit and is correct. Recommended fix: dispatch after the caller's commit
  via the existing after-commit hook.
