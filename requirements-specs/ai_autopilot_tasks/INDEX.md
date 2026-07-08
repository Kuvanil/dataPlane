# AI Autopilot — Task Index (DP-AUTO-001)

> Source: `requirements-specs/TRD_DataPlane_AI_Autopilot.md` (9 FRs, 9 subtasks AUTO-T1–T9).
> Grounded against the code as of 2026-07-08. An "autopilot" already exists
> (`backend/app/api/routers/autopilot.py`, `app/models/autopilot.py`,
> `run_autopilot_task` in `app/tasks/ai_tasks.py`, `frontend/.../autopilot/page.tsx`)
> but it predates governance: it is a single hardcoded agent loop (scan → match → diff →
> PII → SQL-gen → optionally execute) with **no policy, no approval queue, no guardrails,
> no rate limits — and no authentication on any endpoint, including `mode="execute"`
> which copies data into the target.** This epic wraps that loop in the TRD's governance
> layer and generalizes it into a policy-driven action framework.

## FR verdict (state before this epic)

| FR | Requirement | Verdict |
|---|---|---|
| FR1 | Autonomy policy per action type | NOT DONE — no policy model exists |
| FR2 | Recommendations w/ rationale + confidence | NOT DONE — legacy loop logs but recommends nothing actionable |
| FR3 | Approval queue above threshold | NOT DONE |
| FR4 | Bounded autonomous execution (allow-listed, reversible, low-risk only) | NOT DONE — legacy `mode=execute` executes unconditionally |
| FR5 | Hard prohibitions server-side | NOT DONE |
| FR6 | Action log w/ rationale + outcome + reversibility | PARTIAL — `AutopilotLog` is console text, not a decision/action log |
| FR7 | Approve / reject / modify from queue | NOT DONE |
| FR8 | Per-type + global rate limits on autonomous actions | NOT DONE |
| FR9 | Audit events for all activity | PARTIAL — only one `autopilot_run` event on run completion |

## Status legend
- `[ ]` not started · `[~]` in progress · `[x]` completed (landed, tested code only — never "spec written")
- `[!]` blocked (needs manual decision) · `[?]` open — needs human input before auto-implementing

## Priority order (top → bottom)

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_auth_gate_legacy_router.md) | Security NFR, FR5 | [x] | **Hotfix:** auth-gate all legacy autopilot endpoints; role-gate execute mode |
| [02](02_policy_model_api.md) | FR1, AUTO-T1 | [x] | Autonomy policy data model + service + admin API (fail-safe defaults) |
| [03](03_recommendation_action_models.md) | FR2, FR6, §11 | [x] | Recommendation + action-log data models with status machine |
| [04](04_action_registry_guardrails.md) | FR4, FR5, AUTO-T3 | [x] | Action registry + server-side guardrails (allow-list, prohibited hard-block) |
| [05](05_recommendation_engine.md) | FR2, AUTO-T2 | [x] | Recommendation engine: trigger evaluators + beat + event hooks |
| [06](06_approval_queue_executor.md) | FR3, FR7, AUTO-T4/T5 | [x] | Approval queue API + bounded executor (idempotent; legacy execute rerouted) |
| [07](07_rate_limits_circuit_breaker.md) | FR8, AUTO-T7 | [x] | Per-type + global rate limits + failure circuit breaker |
| [08](08_audit_emission.md) | FR9, AUTO-T8 | [x] | Audit emission sweep — every recommendation/decision/execution/block |
| [09](09_frontend_policy_queue_log.md) | AUTO-T1/T4/T6, Usability NFR | [x] | Frontend: policy panel + approval queue + action log on the Autopilot page |
| [10](10_safety_guardrail_tests.md) | AUTO-T9, DoD | [x] | Dedicated safety/guardrail test suite (AC1–AC4 as tests) |
| [11](11_security_signoff.md) | §12 DoD, §9 assumptions | [!] | Security/Compliance sign-off on guardrails + tenant isolation — human gate |

## Design decisions (binding for this epic)

1. **`ApprovalRequest` is folded into `AutopilotRecommendation.status`** (deviation from TRD §11's
   four-model sketch). One row moves `pending → approved|rejected|superseded → executing →
   executed|failed`; a separate approval table would duplicate state and invite drift. The action
   log (`AutopilotActionLog`) stays separate because one recommendation can be attempted more than
   once (retry after transient failure) and each attempt needs its own outcome row.
2. **Rationale is deterministic and metadata-grounded — no LLM on the decision path.** This is the
   TRD §10 prompt-injection mitigation ("decisions grounded in metadata/state, never on
   instructions embedded in data") implemented literally: evaluators template rationale from DB
   state (drift events, health statuses, timestamps). LLM enrichment can be added later as
   display-only text, never as the decision input.
3. **Action taxonomy v1** — only actions whose executors exist in shipped code:
   | action_type | risk | reversible | auto-capable | executor grounding |
   |---|---|---|---|---|
   | `connector_health_check` | low | yes | yes | `run_health_check_for_connection` (connector_tasks #5) |
   | `drift_rescan` | low | yes (additive snapshot) | yes | `_check_single_connection_drift` (schema rescan path) |
   | `mapping_suggestions_refresh` | low | yes (pending suggestions are rejectable) | yes | `MappingService.request_suggestions` |
   | `migration_execute` | high | **no** (writes rows to target) | **never** | legacy `run_autopilot_task(mode="execute")` |
   `pipeline_run` is **deliberately deferred** until Pipelines FR3 (manual run engine) lands —
   there is no real pipeline-run surface to trigger yet (see `Pipelines_tasks/INDEX.md`).
4. **Default-deny executor + explicit prohibited list.** The executor refuses any action_type not
   in the registry (default-deny subsumes every prohibited action). `PROHIBITED_ACTION_TYPES`
   (connection deletes, mapping publish, user/role changes, credential/security changes, raw DDL)
   exists *in addition* so those return an explicit "prohibited, regardless of policy" error and
   are directly testable (AC3). Enforced in the executor service layer, not the router.
5. **Autonomy levels:** `disabled | suggest | approve | auto`, default **suggest** (fail-safe,
   Reliability NFR). `auto` is rejected at the policy API (422) for non-auto-capable action types
   AND clamped again at execution time (defense in depth).
6. **Circuit breaker never mutates admin config.** Breaker state is computed at execution time
   (≥3 consecutive auto-mode failures for a type within the window ⇒ open); an open breaker
   demotes auto-execution to the approval queue and emits an audit event. Config mutation by the
   system would be a silent policy change — exactly what FR5 forbids in spirit.
7. **Recommendation dedupe by `dedupe_key`** (`action_type:subject`) — an open (pending) rec for
   the same subject is refreshed in place, never duplicated (lesson from the mapper's 28-zombie
   pending-suggestion bug, 2026-07-07). Evaluators also **supersede** their own open recs when the
   trigger condition has cleared (e.g. connection back to healthy).
8. **NFR "recommendation ≤10s after trigger":** met for drift + health triggers by dispatching the
   evaluator task inline from those Celery tasks when they detect a trigger-worthy state change;
   the beat sweep (every 2 min, env-configurable) is the safety net, not the primary path.
9. **Roles:** policy edit = admin; approve/reject/modify = admin; evaluate-now = admin/analyst;
   all reads = any authenticated user. Legacy run console: start = admin/analyst.

## Confidence per task

- **#01 auth hotfix** — HIGH. Mechanical, mirrors the connectors hotfix (2026-07-07).
- **#02 policy** — HIGH. Small model + CRUD; the only judgment call (level names, defaults) is
  fixed by design decisions 5.
- **#03 models** — HIGH. New tables only; `create_all` handles them, no ALTER needed.
- **#04 registry/guardrails** — HIGH on structure; the risk/reversibility taxonomy values are a
  product judgment — chosen conservatively (see table above), flagged for #11 sign-off.
- **#05 engine** — MEDIUM. Trigger set v1 (drift, health) is the load-bearing product choice;
  grounded in the two trigger sources that actually persist state today. More triggers are
  additive later.
- **#06 queue/executor** — HIGH on approve/reject + idempotent transitions; MEDIUM on "modify"
  (implemented as payload-edit-then-approve with registry validation — the TRD doesn't specify
  modify semantics).
- **#07 limits** — HIGH. DB-count-based windows; env-configurable via `Settings`.
- **#08 audit** — HIGH. `record_audit` calls woven through 02–07; this task is the verification
  sweep.
- **#09 frontend** — MEDIUM. New panels on an existing page; UX baseline, polish may need review.
- **#10 safety tests** — HIGH. AC1–AC4 map 1:1 to pytest cases.
- **#11 sign-off** — [!] human gate by definition (same pattern as mapper #7, connectors #10).

## Execution order

01 (hotfix first — live vulnerability) → 02 → 03 → 04 → 06 → 05 → 07 → 08 → 09 → 10.
(06 before 05 so the executor exists before anything generates executable recommendations.)

## Progress log

- 2026-07-08 — Epic created from TRD + code audit. Key pre-existing gap: legacy autopilot router
  fully unauthenticated incl. execute mode (same defect class as the connectors hotfix of
  2026-07-07). Tasks 01–10 defined; 11 blocked on human sign-off. Build starting in execution
  order; entries below are appended only when a task's code has landed and its tests pass.
- 2026-07-08 — **Tasks #01–#08 done** (one coherent backend change set). New:
  `AutopilotPolicy`/`AutopilotRecommendation`/`AutopilotActionLog` models (new tables only —
  create_all covers them, no live ALTER needed); `services/autopilot_registry.py` (4-action
  taxonomy v1, PROHIBITED set, default-deny gate, auto-capable import-time invariants);
  `services/autopilot_service.py` (policy CRUD w/ 422-on-non-auto-capable, guarded-UPDATE status
  machine, bounded executor w/ prohibited hard-block → limits → breaker → execute, demote-to-queue
  fail-safe); `services/autopilot_engine.py` (health + drift evaluators, deterministic
  metadata-grounded rationale, dedupe/refresh/supersede); `tasks/autopilot_tasks.py` (beat every
  `AUTOPILOT_EVALUATE_INTERVAL_MINUTES`=2 + executor task); inline evaluate hooks in
  `check_schema_drift_task` and `run_health_check_for_connection` (≤10s NFR); router auth-gated
  everywhere + 8 governance endpoints; `mode="execute"` now returns `queued_for_approval` with a
  `migration_execute` recommendation instead of executing. 6 config knobs added to `Settings`.
  65 new tests (`tests/autopilot/`), suite 329/329.
- 2026-07-08 — **Task #09 done.** Autopilot page rebuilt into tabs: Run console (extracted to
  `components/RunConsole.tsx`, handles the 202-queued reroute by jumping to Approvals), Policy
  panel (autonomy selects with `auto` disabled for non-auto-capable types, read-only for
  non-admin), Approval queue (rationale + evidence expandable, confidence/risk/reversibility
  badges, approve/reject/modify gated on **status** pending + admin role — mapper lesson),
  Action log (outcome chips incl. blocked_*). All HTTP via `lib/api.ts`. 11 new vitest tests
  (46/46 total); tsc/lint(29-baseline)/build clean.
- 2026-07-08 — **Task #10 done.** `tests/autopilot/test_safety_guardrails.py` — AC1 suggest-only
  never executes; AC2 approval gate incl. stray-dispatch refusal; AC3 prohibited hard-block with
  policy row forced to `auto` directly in the DB + forged recommendation (and unknown-type
  default-deny); AC4 auto path end-to-end with rationale/outcome/audit-order assertions;
  disabled-policy supersede; breaker + limits demotion paths in `test_limits_breaker.py`.
- 2026-07-08 — **Live verification** (images rebuilt: api/worker/beat/frontend): unauth → 401;
  policy defaults suggest ×4; PUT auto on `migration_execute` → 422; execute-mode run →
  `queued_for_approval` rec #1; `POST /evaluate` created a real trigger rec (#2: connection
  'target_hr_data' down); approve #2 → executed with `CONNECTION_REFUSED` detail in the action
  log; reject #1 → rejected; audit trail created→evaluated→approved→rejected→executed all
  present; beat fired `autopilot-evaluate-recommendations` at :06 and the engine re-created a
  pending rec for the still-down connection (correct trigger-still-active behavior).
  **FR verdict after this epic: FR1–FR9 all implemented; #11 sign-off remains [!].**
