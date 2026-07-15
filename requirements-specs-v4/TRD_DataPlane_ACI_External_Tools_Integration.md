# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-ACI-001
- **Task Name:** ACI.dev Integration — External Tool-Calling Layer for dataPlane
- **Summary:** Integrate [ACI.dev](https://github.com/aipotheosis-labs/aci) (Apache 2.0,
  self-hostable) as dataPlane's connection to external SaaS tools (Slack, Jira, GitHub, email,
  etc.), so Autopilot recommendations, Agentic DBA Copilot plans (`requirements-specs-v3`), and
  AskData/Query Workspace requests can reach *out* to where people already work — instead of every
  approval/notification living only inside dataPlane's own dashboard.
- **Business Objective:** Reduce the "check the dashboard" friction on governance workflows
  (Autopilot approvals, schema-design plan review, pipeline failures) by fanning them out to
  existing team tools, and give AskData/Query Workspace a governed way to take real-world actions
  ("email this report," "open a ticket," "create a PR") without dataPlane hand-building and
  maintaining a bespoke integration per external service.

---

## 2. Origin

Requested after a capability-brainstorm on how ACI.dev's open-source tool-calling platform could
extend dataPlane. ACI.dev provides: 600+ external tool integrations, multi-tenant OAuth/secrets
management per "linked account," and dynamic tool discovery via meta-functions (search + execute)
so an agent isn't handed 600 tool schemas up front. dataPlane today is entirely DB-connector-
centric — every existing module (AskData, Query Studio, Schema Mapper, Pipelines, Autopilot) acts
only on connected databases; there is no path to an external system anywhere in the platform. This
epic adds that path, deliberately narrow and gated, reusing this repo's established governance
patterns rather than inventing a new authorization model.

---

## 3. Scope

### In-Scope

- Self-hosted ACI.dev backend + dev portal as a new `docker-compose` service (Docker-first, per
  `prompts/11-docker-first.md`), with its API key/base URL configured via `Settings`
  (`backend/app/core/config.py`) — never hardcoded, per this repo's non-negotiables.
- `aci_client_service.py` — a thin backend wrapper around ACI's Python SDK (search + execute
  meta-functions, linked-account resolution), with the same retry/circuit-breaker pattern already
  used for Ollama (`backend/app/core/circuit_breaker.py`) so an ACI outage degrades gracefully
  rather than blocking core platform features.
- A new governance category for **external-system side effects**, extending
  `autopilot_registry.py`'s existing allow-list/risk/reversibility pattern — most external actions
  default-deny/approval-only, a narrow allow-listed subset (e.g. posting to a pre-configured
  internal Slack channel) may be `auto_capable`.
- **Notify-out** fan-out (v1, safer cut): Autopilot recommendations and Agentic DBA Copilot plans
  queued for approval optionally post a notification (Slack/Jira/etc.) linking back to dataPlane's
  own existing approval UI — the approval decision itself still happens inside dataPlane.
- A new `"external_action"` intent in the Agentic DBA Copilot's extensible intent registory
  (`requirements-specs-v3/agentic_dba_tasks/10_extensible_intent_registry.md`), so AskData/Query
  Workspace requests like "email this to the team" or "open a GitHub issue for this" route through
  ACI's dynamic tool discovery.
- Pipeline run/drift notifications reusing the same notification service.
- A minimal frontend surface to see which external apps/linked accounts are connected and which
  dataPlane actions can use them (deep-linking to ACI's own dev portal for the actual OAuth-connect
  flow, rather than rebuilding it).
- Audit events for every ACI-mediated action, distinguishable in the existing Audit Trail.

### Out-of-Scope

- **Bidirectional "approve from Slack"** (an inbound webhook that lets someone approve a
  recommendation/plan directly from Slack/Jira) — this needs its own identity-mapping and
  signature-verification security design and is explicitly deferred to a follow-up (Task #6, kept
  `[?]` open in this epic rather than built).
- Autonomous execution of any external action with a real-world side effect outside dataPlane
  beyond the narrow allow-listed set (mirrors this repo's existing DDL-execution stance — see Risks
  §11).
- dataPlane exposing *itself* as an MCP server (the reverse direction — external agents calling
  into dataPlane). A related idea, but a separate future epic, not this one.
- Multi-tenant scoping of linked accounts/credentials — depends on the tenant-isolation
  architecture decision already deferred elsewhere in this repo (Task #10).
- Rebuilding ACI's own OAuth-connect UI/dev portal — deep-link to it instead.

---

## 4. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Which external actions are worth building first; notify-out UX |
| Tech Lead | _TBD_ | ACI SDK integration boundary, governance-registry extension |
| Backend Engineer | _TBD_ | `aci_client_service`, registry actions, notification wiring |
| Frontend Engineer | _TBD_ | Integrations surface |
| Security | _TBD_ | External-credential surface review, tenant-isolation cross-reference |
| DevOps | _TBD_ | Self-hosted ACI service deployment, secrets handling |
| QA Engineer | _TBD_ | Verification, circuit-breaker/outage behavior |

---

## 5. Functional Requirements

- **FR1:** The platform shall connect to a self-hosted ACI.dev instance via a backend service
  layer, configured entirely through environment variables (no hardcoded API keys/URLs).
- **FR2:** External tool calls shall use ACI's search + execute meta-functions for dynamic
  discovery, not a hand-maintained static list of every possible external tool schema.
- **FR3:** Every external action type shall be registered in an allow-list with an explicit
  risk/reversibility classification, following the same pattern `autopilot_registry.py` already
  uses for internal actions; only a narrow, explicitly reversible/low-risk subset may be
  auto-executable.
- **FR4:** Autopilot recommendations and Agentic DBA Copilot plans queued for approval shall
  optionally trigger a notify-out action (e.g. Slack message) linking back to dataPlane's existing
  approval UI.
- **FR5:** AskData/Query Workspace shall recognize a new `"external_action"` intent and route it
  through the ACI client service rather than attempting NL-to-SQL generation against it.
- **FR6:** Pipeline run failures/successes and drift-impact events shall be able to trigger the
  same notification service.
- **FR7:** A frontend surface shall show which external apps/linked accounts are connected and
  which dataPlane action types can use them.
- **FR8:** Every ACI-mediated action shall emit a distinguishable audit event.
- **FR9:** An ACI service outage shall degrade gracefully (circuit breaker opens, core platform
  features unaffected) rather than blocking unrelated dataPlane functionality.

---

## 6. Non-Functional Requirements

- **Security:** External action execution follows the same "propose → approve → execute" default
  as every other consequential capability in this platform (DDL execution, mapping publish) —
  autonomous execution is the exception requiring an explicit, narrow allow-list, not the default.
- **Reliability:** Reuse the existing `CircuitBreaker` class (`backend/app/core/circuit_breaker.py`)
  for ACI calls rather than building a second implementation.
- **Performance:** Notification/external-action calls must not block the request path they're
  attached to (e.g. queuing an Autopilot recommendation should not wait on a Slack API round-trip)
  — dispatch async (Celery), consistent with existing task patterns.
- **Auditability:** External actions are logged with enough detail (which app, which linked
  account, which dataPlane action triggered it) to reconstruct what happened without needing ACI's
  own logs.
- **Operability:** Self-hosted ACI service has a health check and is documented in
  `docker-compose.yml` consistently with every other service in this stack.

---

## 7. Task Breakdown / Subtasks

See `aci_integration_tasks/INDEX.md` for the full task list (11 tasks), confidence notes,
execution order, and progress log.

---

## 8. Acceptance Criteria

**AC1 — Self-hosted ACI reachable and configured via env vars**
- **Given** the docker-compose stack is brought up
- **When** the `api` service starts
- **Then** it can reach the ACI service using a base URL/API key sourced from `Settings`, with no
  hardcoded value anywhere in the codebase.

**AC2 — External action requires approval by default**
- **Given** a new external action type not on the narrow auto-capable allow-list
- **When** it's triggered (by Autopilot, the Agentic DBA Copilot, or a direct AskData request)
- **Then** it is queued for human approval, not executed automatically.

**AC3 — Notify-out reaches the configured channel/tool**
- **Given** an Autopilot recommendation or Agentic DBA plan enters the approval queue
- **When** notify-out is enabled for that action type
- **Then** a message is posted to the configured external destination linking back to dataPlane's
  approval UI.

**AC4 — ACI outage doesn't break the platform**
- **Given** the ACI service is unreachable
- **When** any dataPlane feature that would call it is exercised
- **Then** the circuit breaker opens, the calling feature fails gracefully (clear error, no hang),
  and unrelated dataPlane functionality is unaffected.

**AC5 — Every external action is audited**
- **Given** any ACI-mediated action executes (notify-out or an approved external_action)
- **When** it completes (success or failure)
- **Then** a distinguishable audit event is recorded.

**Checklist**
- [ ] Self-hosted ACI service running in `docker-compose.yml`, env-var configured.
- [ ] `aci_client_service.py` implemented with circuit breaker reuse.
- [ ] External-action governance registry extension implemented, default-deny enforced.
- [ ] Notify-out wired to Autopilot + Agentic DBA Copilot approval queues.
- [ ] `external_action` intent implemented in the extensible intent registry.
- [ ] Pipeline notifications wired.
- [ ] Frontend integrations surface shipped.
- [ ] Audit events emitted for every external action.
- [ ] Tenant-isolation cross-reference recorded.
- [ ] Security sign-off obtained before any auto-capable external action ships.

---

## 9. Dependencies

**Internal:** Autopilot (governance registry pattern to extend), Agentic DBA Copilot
(`requirements-specs-v3`, approval-queue and intent-registry integration points), Pipelines
(notification trigger points), Audit Trail, `backend/app/core/circuit_breaker.py`, the still-
unresolved Tenant Isolation architecture decision.
**External:** ACI.dev (self-hosted backend + dev portal, Apache 2.0), the specific SaaS apps
connected through it (Slack/Jira/GitHub/etc., each with their own OAuth app registration outside
this repo).

---

## 10. Assumptions

- Self-hosting ACI.dev (rather than using a hosted/cloud offering) is the right default given this
  repo's Docker-first, self-hosted-stack convention — flagged as an explicit decision point in
  Task #1, not silently assumed.
- ACI's own OAuth-connect UX (its dev portal) is good enough to reuse via deep-link rather than
  reimplementing inside dataPlane's frontend.
- The set of external actions worth building first is small and product-prioritized (start with
  notify-out; expand deliberately) rather than "integrate everything ACI offers at once."

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Autonomous external side effects creep beyond the narrow allow-list | High | Same default-deny/approval-only pattern as DDL execution; auto-capable set stays explicit and reviewed, not a config toggle |
| A second, ungoverned credential surface (ACI's OAuth vault) undermines this repo's existing credential-vaulting caution | Medium | ACI's vault is scoped to *external SaaS* credentials, separate from dataPlane's own DB-connector secrets (still unresolved at `connector_tasks#2`) — don't conflate the two, and don't let this epic quietly become the de facto answer to that unresolved decision |
| Inbound webhook (approve-from-Slack) identity mapping done hastily | High | Explicitly deferred (Task #6), not built in this epic's v1 |
| ACI outage cascades into unrelated dataPlane failures | Medium | Reuse the existing circuit-breaker pattern; verify degraded behavior explicitly (Task #11) |
| Tenant isolation gap extends into a new external-integration surface | High | Cross-reference the existing deferred decision (Task #10), don't bypass it |
| Notification spam / alert fatigue from over-eager fan-out | Low-Medium | Notify-out is opt-in per action type, not a blanket "notify everything" default |

---

## 12. Technical Notes

- **New service:** `backend/app/services/aci_client_service.py` — wraps ACI's Python SDK; exposes
  `search_tools(query)` / `execute_tool(tool_name, params, linked_account)` primitives, wrapped in
  the existing `CircuitBreaker` class.
- **New config:** `Settings` gains `ACI_BASE_URL`, `ACI_API_KEY` (env-var sourced, matching the
  `OLLAMA_*` settings' existing shape in `backend/app/core/config.py`).
- **New docker-compose service:** `aci` (backend) [+ `aci-portal` if self-hosting the dev portal
  too — confirm whether both are needed for this epic's scope or just the backend API], with a
  health check, following every other service's existing pattern in `docker-compose.yml`.
- **Registry extension:** new action types in `autopilot_registry.py`'s allow-list — e.g.
  `notify_slack` (`auto_capable=True`, `risk="low"`, `reversible=True`, restricted to a
  pre-configured internal channel) vs. `external_ticket_create` (`auto_capable=False`,
  `risk="medium"`, approval-only).
- **Intent registry hook:** extends `requirements-specs-v3/agentic_dba_tasks/10`'s registry — a
  new `"external_action"` entry whose handler is `aci_client_service`'s search+execute, not a local
  NL2SQL-style generator.

---

## 13. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration tests passing, including simulated-outage circuit-breaker behavior.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on the external-credential surface and the tenant-isolation
      cross-reference.
- [ ] Acceptance criteria met.
- [ ] Documentation updated; `MEMORY.md` and this epic's `INDEX.md` progress log current.
