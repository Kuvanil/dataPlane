# Task 04 — Action registry + server-side guardrails (FR4, FR5)

**TRD:** FR4, FR5, AC3, AUTO-T3, §10 risk table, §11 constraints.

## New file `backend/app/services/autopilot_registry.py`

- `@dataclass(frozen=True) ActionSpec`: `action_type`, `description`, `risk`, `reversible`,
  `reversibility_note`, `auto_capable` (must be `reversible and risk == "low"` — assert at
  import), `required_payload_keys: frozenset`, `execute: Callable[[Session, dict, str], dict]`.
- `ACTION_REGISTRY: Dict[str, ActionSpec]` with exactly the taxonomy v1 from INDEX decision 3:
  `connector_health_check`, `drift_rescan`, `mapping_suggestions_refresh`, `migration_execute`.
- `PROHIBITED_ACTION_TYPES: frozenset` = `{connection_delete, connection_hard_delete,
  mapping_publish, user_role_change, credential_change, security_setting_change, ddl_execute}`.
- `check_action_allowed(action_type) -> ActionSpec`: raises `ProhibitedActionError` for the
  prohibited set (explicit message "prohibited regardless of policy configuration"), raises
  `UnknownActionError` for anything else not in the registry (**default-deny**). The executor
  and the policy API both call this — guardrails live in the service layer, never the router.
- Executor callables ground into existing code ONLY:
  - `connector_health_check{connection_id}` → reuse the health-check task's core (test +
    `ConnectionService.update_health`), synchronous.
  - `drift_rescan{connection_id}` → `_check_single_connection_drift(db, conn, actor)` + commit.
  - `mapping_suggestions_refresh{mapping_id}` → `MappingService.request_suggestions` (its
    `_assert_draft` failing on a published mapping is a *clean execution failure*, not a crash).
  - `migration_execute{source_id, target_id}` → dispatch legacy `run_autopilot_task` with
    `mode="execute"`; returns `{run_id}`.

## Payload validation

`validate_payload(spec, payload)` — required keys present, ints where int-like; 422 otherwise.
Used by approve/modify (task 06) and by the engine (task 05).

## Tests

Prohibited type → ProhibitedActionError for every autonomy level; unknown type → UnknownActionError;
`auto_capable` invariant holds for all registry entries; payload validation rejects missing keys.
