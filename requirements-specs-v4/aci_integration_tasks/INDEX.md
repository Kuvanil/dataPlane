# ACI.dev Integration (DP-ACI-001) — Task Index

> Source: `requirements-specs-v4/TRD_DataPlane_ACI_External_Tools_Integration.md`.
> Origin: a capability-brainstorm on [ACI.dev](https://github.com/aipotheosis-labs/aci) (Apache
> 2.0, self-hostable tool-calling platform — 600+ external SaaS integrations, multi-tenant
> OAuth/secrets, dynamic tool discovery via search+execute meta-functions). This is a **net-new
> capability**, not a gap-closure pass — dataPlane today has no path from any module to an
> external (non-database) system.

## Why this is additive to, not a replacement for, existing infra

dataPlane already has its own "connector" concept (`backend/app/models/` DB connections) and its
own governed-action registry (`autopilot_registry.py`'s allow-list, extended for schema-design
actions in `requirements-specs-v3/agentic_dba_tasks`). Both are scoped to **databases and internal
platform actions**. ACI.dev's value is entirely orthogonal: reaching *external* SaaS tools (Slack,
Jira, GitHub, email, etc.) with credential/OAuth management dataPlane doesn't need to build itself.
This epic is a thin integration layer wired into the governance patterns that already exist — it
does not introduce a second authorization model.

## Design decisions & edge cases (read before implementing any task below)

1. **Notify-out first; bidirectional approve-from-Slack deliberately deferred.** The safe, useful
   v1 is: dataPlane pushes a notification to an external tool linking back to its own approval UI.
   The harder, riskier version — approving *from* Slack/Jira directly — requires an inbound
   webhook, signature verification, and mapping an external identity (a Slack user) to a dataPlane
   role with approval authority. That's real security-sensitive design work, not a natural
   extension of notify-out, and is explicitly Task #6, kept `[?]` open rather than built here.
2. **Default-deny for external side effects, same as DDL.** Extend
   `autopilot_registry.py`'s existing `risk`/`reversible`/`auto_capable` pattern — most external
   actions (creating a ticket, sending an email, opening a PR) are approval-only. Only a narrow,
   explicitly reversible/low-risk subset (e.g. posting to one pre-configured internal Slack
   channel) may be `auto_capable`, mirroring exactly how `migration_execute`/`ddl_execute` are
   already treated as approval-only-by-design in this codebase, not a new stance invented for this
   epic.
3. **Two separate credential surfaces — don't conflate them.** ACI's OAuth vault holds *external
   SaaS* tokens (Slack, Jira, etc.). dataPlane's own DB-connector credential-vaulting decision
   (`connector_tasks#2`) is still unresolved and is a *different* concern (database passwords, not
   SaaS OAuth). This epic must not become the accidental de facto answer to that unresolved
   decision — it solves a narrower, different problem.
4. **Reuse the existing circuit breaker, don't build a second one.** `backend/app/core/
   circuit_breaker.py` already exists for exactly this class of problem (Ollama calls degrading
   gracefully). ACI calls get the same treatment — an ACI outage must not cascade into unrelated
   dataPlane feature failures.
5. **Async dispatch, never block a request path on an external API round-trip.** Queuing an
   Autopilot recommendation or an Agentic DBA plan must not wait on Slack's API responding —
   notify-out is a background task (Celery), consistent with this repo's existing task patterns.
6. **Deep-link to ACI's own dev portal for OAuth-connect UX; don't rebuild it.** ACI already has a
   UI for linking external accounts. dataPlane's frontend surface (Task #8) shows *which* linked
   accounts/apps exist and which dataPlane action types can use them — it does not reimplement
   ACI's OAuth flows.
7. **Tenant isolation is out of scope to solve here — cross-reference, don't ignore (Task #10).**
   Per-tenant scoping of linked accounts is a real future question this epic's design should not
   quietly foreclose or silently bypass.
8. **Start narrow on which external actions get built.** ACI exposes 600+ tools; this epic
   integrates the client/governance/notification *layer*, not every possible tool. Product
   prioritizes which specific external actions (Slack notify, Jira ticket, GitHub PR) actually get
   registered and shipped first — resist building broad tool coverage speculatively.
9. **No blanket "notify everything."** Notify-out is opt-in per action type/severity, not a default
   that fires on every Autopilot recommendation regardless of significance — alert fatigue defeats
   the point.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Title | Status | Depends on |
|---|---|---|---|
| [01](01_deployment_and_service_wiring.md) | Self-host decision + ACI service wiring into docker-compose | [x] | — |
| [02](02_aci_client_service.md) | `aci_client_service.py` backend wrapper (search/execute, circuit breaker) | [x] | #1 |
| [03](03_external_action_governance.md) | Governance registry extension for external-system side effects | [x] | #2 |
| [04](04_external_action_intent.md) | `"external_action"` intent in the Agentic DBA Copilot's intent registry | [x] | #2, #3 |
| [05](05_approval_notify_out.md) | Notify-out fan-out for Autopilot + Agentic DBA Copilot approval queues | [x] | #2, #3 |
| [06](06_bidirectional_approval_deferred.md) | Bidirectional "approve from Slack/Jira" (inbound webhook) | [?] | #5 |
| [07](07_pipeline_notifications.md) | Pipeline run/drift notifications via the same notification service | [x] | #2, #3 |
| [08](08_frontend_integrations_surface.md) | Frontend: connected apps/linked-accounts surface | [x] | #2 |
| [09](09_audit_events.md) | Audit events for every ACI-mediated action | [x] | #3, #4, #5, #7 |
| [10](10_tenant_isolation_and_signoff.md) | Tenant-isolation cross-reference + security sign-off | [!] | #3, #5 |
| [11](11_tests_and_outage_verification.md) | Tests + circuit-breaker/outage-behavior verification | [x] | #1–#9 |

## Confidence per task (auto-mode implementation)

- **#1 Deployment decision** — **`[?]` open.** Self-host vs. hosted API is a real infra/cost/
  product decision (a new service to run and maintain vs. an external dependency on ACI's hosted
  offering) — shouldn't be auto-decided. Recommendation in the TRD is self-host, consistent with
  this repo's Docker-first convention, but flag for explicit sign-off before building.
- **#2 Client service** — HIGH confidence once #1 is resolved. Mechanical wrapper + reuse of an
  existing circuit-breaker class.
- **#3 Governance extension** — HIGH confidence — extends an existing, well-understood pattern
  (`autopilot_registry.py`) rather than designing a new one.
- **#4 External-action intent** — MEDIUM confidence. Depends on
  `requirements-specs-v3/agentic_dba_tasks/10`'s registry existing in a compatible shape; if that
  epic hasn't landed yet, this task needs its own minimal intent hook rather than blocking entirely
  on v3.
- **#5 Notify-out** — MEDIUM-HIGH confidence. Mechanical once #2/#3 exist; needs care around
  "opt-in per action type" (decision #9), not a blanket default.
- **#6 Bidirectional approval** — **`[?]` open, deferred.** Real security design work (signature
  verification, external-identity-to-dataPlane-role mapping) that deserves its own review, not a
  fast-follow bolt-on.
- **#7 Pipeline notifications** — HIGH confidence, reuses #2/#3/#5's plumbing.
- **#8 Frontend surface** — MEDIUM confidence — deliberately thin (list + deep-link), per decision
  #6, not a full integrations-management UI.
- **#9 Audit events** — HIGH confidence, follows the established `emit_audit_event` pattern used
  throughout this codebase.
- **#10 Tenant isolation + sign-off** — **`[!]` blocked**, same as every other epic that's hit this
  gap (this is the eighth: mapper, schema intel, connectors, dashboard, autopilot, the original
  schema-mapper review, the Agentic DBA Copilot epic, now this one).
- **#11 Tests + outage verification** — MEDIUM confidence. The circuit-breaker/outage-behavior
  test is the one most likely to be under-scoped if rushed — it's the actual proof of NFR9, not
  optional polish.

## Execution order (in auto mode)

1. **#1 Deployment decision** — blocks everything; get explicit sign-off before building anything
   downstream.
2. **#2 Client service** — foundation for all remaining tasks.
3. **#3 Governance extension** — depends on #2 existing to have something to gate.
4. **#4 External-action intent** and **#5 Notify-out** — both depend on #2/#3; independent of each
   other, can proceed in parallel.
5. **#7 Pipeline notifications** — depends on #2/#3, independent of #4/#5/#6.
6. **#8 Frontend surface** — depends on #2 (needs linked-account data to display); can proceed in
   parallel with #4/#5/#7.
7. **#6 Bidirectional approval** — stays `[?]` regardless of when raised; pursue only after #5 is
   stable and only with dedicated security review.
8. **#9 Audit events** — incremental, integrated alongside #3/#4/#5/#7 as they land, not held to
   the end in practice despite the dependency line above.
9. **#10 Tenant isolation + sign-off** — pursue in parallel once #3/#5 exist enough to review
   concretely; stays `[!]` regardless of timing.
10. **#11 Tests + outage verification** — last, closing out the epic.

## Out of scope (confirmed, per TRD §3)

- Bidirectional approve-from-Slack in this epic's v1 (Task #6 stays open).
- Autonomous execution of external actions beyond the narrow allow-listed set.
- dataPlane exposing itself as an MCP server (reverse direction) — a separate future epic.
- Multi-tenant scoping of linked accounts/credentials (cross-referenced, not solved, at #10).
- Rebuilding ACI's own OAuth-connect UI.

## Progress log

- 2026-07-14 — Epic scoped from a capability-brainstorm on ACI.dev. TRD + INDEX.md created, 11
  tasks defined, grounded in ACI.dev's actual README (architecture: apps/functions/linked
  accounts/agent-project, meta-function dynamic discovery, multi-tenant OAuth, VibeOps, MCP server
  + SDK access patterns, Apache 2.0, self-hostable) and this repo's existing governance
  infrastructure (`autopilot_registry.py`, `circuit_breaker.py`). Not started.
- 2026-07-14 — **Tasks #1–#5, #7–#9, #11 built and verified** (single build session; #6 stays
  `[?]` deferred, #10 stays `[!]`). **Decision #1 resolved: repo owner explicitly chose
  self-host-in-docker-compose** (over hosted API / env-only wiring) when asked directly.
  - **#1 done.** `aci` (built from a cloned `vendor/aci` — clone documented in compose comments;
    ACI ships no prebuilt backend image) + `aci-db` (pgvector/pg16) added to `docker-compose.yml`
    under an **optional `--profile aci`** so the default `docker compose up -d` stack is
    unchanged; `docker compose config` validates. Honest caveats recorded: self-hosted ACI needs
    its own `SERVER_OPENAI_API_KEY` (embedding-based tool search) and its self-host seed catalog
    is small (Brave Search, Hacker News, Gmail) vs. the hosted 600+. `Settings` gained
    `ACI_BASE_URL`/`ACI_API_KEY` (no checked-in fallback — unset = integration disabled with a
    clear error, not a mystery auth failure)/`ACI_PORTAL_URL`/`ACI_LINKED_ACCOUNT_OWNER_ID`/
    `ACI_TIMEOUT`/`ACI_MAX_RETRIES`/`ACI_SLACK_INTERNAL_CHANNEL`/`DATAPLANE_BASE_URL`;
    `.env.example` documented; `aci-sdk==1.0.0b4` added to requirements (installed; real SDK
    surface verified to match: `ACI(api_key, base_url)`, `functions.search(intent=...)`,
    `functions.execute(function_name, function_arguments, linked_account_owner_id)`,
    `linked_accounts.list()`).
  - **#2 done.** `aci_client_service.py` — singleton `aci_client` wrapping the SDK (deferred
    import; tests stub `_get_client`) behind a named `CircuitBreaker("aci")` + exponential-backoff
    retries + `[aci] op=...` logging. `AciNotConfigured` for the unset-key case.
  - **#3 done.** Four external actions in `autopilot_registry.py` under the SAME
    risk/reversible/auto_capable model (no new dimension needed): `notify_slack_internal`
    (auto-capable, low, reversible — the ONLY auto one; its executor structurally ignores any
    payload channel and posts only to admin-set `ACI_SLACK_INTERNAL_CHANNEL`),
    `external_message_send` (reversible but destination user-suppliable → approval-only, the crux
    rule made structural), `external_ticket_create` (medium, approval-only),
    `external_email_send` (high, approval-only). Import-time assertions pass.
  - **#4 done.** v3's intent registry HAD landed (same session) so this is a real registry entry,
    not the stop-gap: `external_action` IntentSpec (priority above schema_design/read_query),
    handler in `askdata_pipeline_service._handle_external_action` — resolves the target
    (email addr → email_send, `#channel` → message_send, ticket words → ticket_create;
    unresolvable → clarifying question, no discovery call), runs `search_tools`, then queues an
    **Autopilot recommendation** (reusing the entire existing approval queue/execute path — no
    parallel approval flow). ACI outage → clear fast error; read-query path untouched.
  - **#5 done.** New `NotificationSetting` model (per-event-key opt-in, OFF by default) +
    `notification_service.dispatch_notify_out` (fire-and-forget; never raises) + Celery
    `notify_out_task` (single-shot by design — the client already retries; a Celery retry layer
    would risk duplicate messages). Wired at: `upsert_recommendation` (new pending rec →
    `autopilot:<action_type>`), `generate_plan` ready (`agentic_dba:schema_design_create`).
    Tests prove the load-bearing guarantee: broker/ACI failure leaves the recommendation/plan
    state completely untouched.
  - **#7 done.** `pipeline_executor._update_run_status` terminal statuses →
    `pipeline:run_success` / `pipeline:run_failure` (independently configurable), with
    drift-blocked failures routed to their own `pipeline:drift_impact` key.
  - **#8 done.** `/api/v1/integrations` router (status incl. governed-action list from the
    registry, linked-accounts with graceful degradation — never 500s because ACI is down,
    notification-settings GET/PUT admin-gated) + `/dashboard/integrations` page (linked accounts,
    governed actions with risk/approval badges, notify-out toggles, "Connect a new app ↗"
    deep-linking to ACI's portal — OAuth never rebuilt in dataPlane) + sidebar entry. 5 component
    tests.
  - **#9 done.** `module=aci_integration` events: `aci.notify_dispatched`/`aci.notify_failed`
    (worker), `aci.external_action_requested` (chat intent), `aci.external_action_executed`
    (each executor, with destination), `aci.notify_setting_changed` (settings PUT). Filterable in
    the existing Audit Trail UI with zero Audit Trail code changes.
  - **#11 done (automated half).** 39 tests in `tests/aci/` + 8 in
    `tests/askdata/test_external_action_intent.py`: breaker opens after threshold and fails fast;
    open circuit consumes no SDK calls; recommendation writes unaffected by full ACI outage;
    integrations endpoint degrades to a clear error; chat external_action fails fast with the
    circuit open and queues nothing. **Honest caveat:** the manual walkthrough (stack up with the
    `aci` service stopped, real Slack message arriving) remains open — it needs a provisioned ACI
    instance + linked Slack account, which don't exist in this environment. That manual pass is
    still the task's final acceptance bar per its Verify section.
  - Verification: `pytest tests/aci/ tests/askdata/` 86/86; frontend `tsc` clean, `vitest`
    125/125, `next build` clean, `next lint` zero new issues (8 pre-existing errors in
    schema-mapper/tenants components unchanged); `docker compose config` valid.
- 2026-07-14 — **Full-suite regression pass:** entire backend `pytest tests/` 796/796 green
  (includes all pre-existing suites: connectors 260-series, mapping, pipelines, schema_catalog,
  audit, autopilot, security, semantic, viz — none regressed by this session's three epics).
  Frontend: `tsc --noEmit` clean, `vitest run` 125/125, `next build` clean, `next lint` zero new
  issues. One session-discovered gotcha worth knowing: a live local Ollama makes plan-generation
  tests nondeterministic — `tests/agentic_dba/conftest.py` pins `AGENTIC_DBA_LLM_ENABLED=False`
  and the LLM path has its own mocked-boundary tests instead.
- 2026-07-15 — **Second validation pass — 4 defects fixed, 1 documented; see `bugs2.md` +
  `enhancements2.md`.** Fixed: (BUG-01) `AciNotConfigured` was counted as a circuit-breaker
  failure, so after 5 unconfigured calls the clear "not configured" error degraded into a
  misleading "circuit open" (and the shared breaker was polluted before ACI was ever configured) —
  `_get_client()` now resolves outside the breaker; (BUG-02) external-action target resolution
  mis-routed ticket requests containing a cc'd email or an issue number (`#500` treated as a Slack
  channel) — explicit ticket requests (verb+noun) now take precedence and `_CHANNEL_RE` requires a
  letter-led name; (BUG-03) GET `/integrations/notification-settings` was not admin-gated (contract
  says GET+PUT) — now `require_role("admin")`; (BUG-04) `notify_out_task` could raise out of its
  own `except` on a poisoned session — now rolls back before the failure audit. Documented (not
  fixed): notify-out dispatched before the caller commits in `upsert_recommendation` (dangling
  notification on rollback — needs the after-commit dispatch hook). Regression tests added; backend
  `pytest` 811/811.
