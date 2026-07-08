# Task 07 — Rate/volume limits + circuit breaker (FR8)

**TRD:** FR8, AUTO-T7, §10 "runaway automated volume".

## Limits (checked in the executor's auto path only — human approvals are never rate-limited)

In `autopilot_service.py`:
- `count_auto_actions(db, action_type=None, window)` — count `AutopilotActionLog` rows with
  `mode="auto"` and `started_at > now - window` (per-type when given, global otherwise).
- Per-type limit: policy row `max_auto_per_hour` (default `Settings.AUTOPILOT_TYPE_AUTO_LIMIT_PER_HOUR`).
- Global limit: `Settings.AUTOPILOT_GLOBAL_AUTO_LIMIT_PER_HOUR`.
- Over either limit ⇒ demote to approval queue (rec stays/returns `pending`), action-log row
  `outcome=blocked_rate_limit`, audit `autopilot_rate_limited`. Never silently dropped.

## Circuit breaker (INDEX decision 6 — never mutates config)

- `breaker_open(db, action_type)` — true when the last `AUTOPILOT_BREAKER_THRESHOLD` (default 3)
  auto-mode attempts for that type within `AUTOPILOT_BREAKER_WINDOW_MINUTES` (default 60) are all
  `failure`. Computed at execution time from the action log; no state row.
- Open breaker ⇒ demote to approval queue, log row `outcome=blocked_breaker`, audit
  `autopilot_circuit_breaker_open`. A human approval executing successfully naturally resets the
  streak (its attempt is `mode="approved"`, and the next auto attempt starts a fresh evaluation
  after any auto success).

## Tests

Type limit: N successful auto runs then the N+1th demotes with `blocked_rate_limit`; global limit
across two types; breaker: 3 consecutive auto failures open it, demotion occurs, a subsequent
success closes it; human approvals unaffected by limits.
