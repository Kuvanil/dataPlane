# Bug 05: `_demote_to_queue` action log omits structured `blocked_by` field, making audit queries brittle

- **Severity:** Low
- **File:** `backend/app/services/autopilot_service.py` lines 465-469
- **Status:** Fixed (2026-07-09)

## Description

When the auto execution path demotes a recommendation to the approval queue (due to policy change, open circuit breaker, or rate limit), the action log records `outcome` as `"blocked_policy"`, `"blocked_breaker"`, or `"blocked_rate_limit"` — but the reason text is embedded as unstructured human-readable text inside `detail["reason"]`. Any downstream audit query or compliance report that needs to distinguish *why* an action was blocked must parse free-text strings, which is brittle across deployments and locales.

## The Problematic Code

```python
@staticmethod
def _demote_to_queue(db: Session, rec: AutopilotRecommendation, *,
                     outcome: str, event_type: str, reason: str) -> Dict[str, Any]:
    started = _now()
    AutopilotService._log_action(
        db, rec=rec, action_type=rec.action_type, payload=rec.payload,
        mode="auto", outcome=outcome, detail={"reason": reason},
        reversibility_note=rec.reversibility_note,
        actor="autopilot-policy", started_at=started,
    )
```

The callers pass:
- `outcome="blocked_breaker"`, `reason=f"circuit breaker open: last {n} auto attempts failed"`
- `outcome="blocked_rate_limit"`, `reason=f"per-type limit reached ({n}/{m} auto actions...)"`
- `outcome="blocked_policy"`, `reason=f"policy autonomy is '{a}' / auto_capable={c} at execution time"`

The `detail` JSON object has no structured keys like `{"blocked_by": "breaker", "type": "connector_health_check", "current_count": 5, "limit": 3}`. Audit queries must do string matching on `detail["reason"]`, which is fragile.

## Impact

- **Brittle audit queries:** Writing a SQL query to find all breaker-blocked actions requires `WHERE detail->>'reason' LIKE '%circuit breaker%'` instead of `WHERE detail->>'blocked_by' = 'breaker'`.
- **Compliance risk:** If a compliance auditor asks "show me every time the breaker prevented an action in Q3", the response relies on text matching that may break if the reason string is refactored (e.g., changing "circuit breaker open" to "breaker open").
- **No test coverage:** No test asserts that the detail JSON contains structured keys — tests only check the `outcome` string on the action log row.

## Suggested Fix

Add a structured `blocked_by` key to the `detail` JSON:

```python
detail = {
    "blocked_by": "breaker",  # "breaker" | "rate_limit" | "policy" | "prohibited"
    "reason": reason,
}
```

Update the three callers in `execute_recommendation` to pass `blocked_by`:

```python
# Breaker
AutopilotService._demote_to_queue(
    db, rec, outcome="blocked_breaker",
    event_type="autopilot_circuit_breaker_open",
    reason=f"circuit breaker open...",
)

# Rate limit
AutopilotService._demote_to_queue(
    db, rec, outcome="blocked_rate_limit",
    event_type="autopilot_rate_limited",
    reason=f"per-type limit reached...",
)

# Policy
AutopilotService._demote_to_queue(
    db, rec, outcome="blocked_policy",
    event_type="autopilot_auto_demoted",
    reason=f"policy autonomy is...",
)
```

Then in `_demote_to_queue`, merge `blocked_by` into the detail:

```python
detail = {
    "blocked_by": outcome.replace("blocked_", ""),  # "breaker" | "rate_limit" | "policy"
    "reason": reason,
}
```

And update the `_log_action` call to use `detail` instead of `{"reason": reason}`.

## Detection

Search for `SELECT .* WHERE detail->>.*LIKE '%circuit breaker%'` in any audit query code or BI tool — if such queries exist, they will break when the reason string changes.

## Resolution

**Fixed 2026-07-09.** All block paths now write structured `detail.blocked_by` (`rate_limit` | `breaker` | `policy` | `prohibited`) alongside the human-readable reason, and the corresponding audit payloads carry the same `blocked_by` key. Regression test: `test_bug05_blocked_detail_has_structured_blocked_by`.
