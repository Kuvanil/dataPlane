# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-KSM-001
- **Task Name:** Keeper Secrets Manager Integration — External Vault Backend for Connector
  Credential Vaulting
- **Summary:** Implement the `SecretManager` abstraction that `connector_tasks/02_secret_manager_integration.md`
  already designed but never built, and add **Keeper Secrets Manager (KSM)** — the vault product
  behind KeeperDB/KeeperPAM — as a concrete "Implementation #2: external vault" backend, resolving
  the `[!]` blocked decision that has gated `connector_tasks#2` and `#8` since 2026-07-06.
- **Business Objective:** Stop storing database connector passwords in plaintext JSON
  (`connections.config`) and get credential rotation "for free" (rotate once in the vault, every
  connector re-fetches the new value) instead of building and maintaining dataPlane's own rotation
  UI/endpoint from scratch.

---

## 2. Origin

Requested after the user asked how **KeeperDB** — described as "a database management tool for
Postgres, MySQL, SQLite, MSSQL, Oracle, Redshift" — could be leveraged in this repo. Research
(see Technical Notes §12 for citations) found:

- **KeeperDB itself is a desktop GUI client** (Windows/macOS/Linux) from Keeper Security — a
  DBeaver/pgAdmin replacement with a query editor, schema explorer, ER diagrams, and an embedded
  "KeeperAI" NL-to-SQL assistant. It supports PostgreSQL, MySQL, SQL Server, Oracle, Redshift,
  SQLite, MongoDB, and DynamoDB. It has **no documented public API or CLI** — it's launched either
  standalone or from a KeeperPAM vault record for a "passwordless" privileged session (credentials
  flow Vault → Gateway → KeeperDB in-memory, never touching the client's disk).
- **The actual integrable product is Keeper Secrets Manager (KSM)** — a separate, sibling Keeper
  product with an open-source Python SDK (`keeper-secrets-manager-core` on PyPI, MIT-licensed,
  Python 3.9–3.13, matching this repo's backend runtime), a documented notation-based API for
  fetching/rotating secrets, and zero-knowledge architecture (secrets decrypt only on the
  customer's device/gateway, never on Keeper's servers). KSM is what feeds credentials into
  KeeperDB/KeeperPAM sessions — it's the piece with a real integration surface.
- This maps directly onto a **known, already-scoped gap** in this codebase:
  `requirements-specs/connector_tasks/02_secret_manager_integration.md` designed a pluggable
  `SecretManager` interface (`store`/`retrieve`/`rotate`/`delete`) specifically so a future external
  vault could be swapped in without touching connector code — but that task has sat `[!]` blocked
  since 2026-07-06 pending a sign-off on "AES-256-GCM self-hosted encryption vs. an external vault
  (HashiCorp Vault, AWS Secrets Manager, etc.) from day one." KSM is a concrete answer in that same
  category. This epic does not reopen that design — it builds the interface exactly as specified
  there and adds KSM as the pluggable backend.

This epic is **narrower and less speculative than a typical net-new integration**: the abstraction
boundary was already designed by a prior audit; this epic implements it and picks a backend.

---

## 3. Scope

### In-Scope

- Build `backend/app/services/secret_manager.py` — the `SecretManager` abstract interface exactly
  as specified in `connector_tasks/02` (`store`/`retrieve`/`rotate`/`delete`), which **does not
  exist in the codebase today** (confirmed: no `secret_manager.py` anywhere in `backend/app/`).
- `KeeperSecretsManagerBackend` — a concrete implementation wrapping
  `keeper-secrets-manager-core`, configured entirely through `Settings`
  (`backend/app/core/config.py`), no hardcoded tokens, wrapped in the existing `CircuitBreaker`
  class (`backend/app/core/circuit_breaker.py`) so a KSM outage degrades gracefully.
- Wiring `ConnectionService`'s create/get/update/delete paths to the new abstraction, per the
  field-by-field plan already laid out in `connector_tasks#2` (known secret fields per connector
  type: `postgres`/`mysql`/`oracle` → `password`; `sqlite` → none).
- The one-time, explicit backfill migration for existing plaintext-in-`config` rows (per
  `connector_tasks#2`'s corrected 2026-07-06 note: a startup step or an explicit admin endpoint,
  never an implicit side effect of a `GET`).
- Credential rotation (`connector_tasks#8`) delegating to KSM's own centralized rotation instead of
  dataPlane re-implementing rotation logic — "rotate once in the vault, every connector re-fetches"
  rather than a bespoke dataPlane rotation flow.
- Docker/env wiring for KSM's one-time-token bootstrap and config storage, following this repo's
  Docker-first, no-hardcoded-secrets convention.
- Audit events for every `store`/`retrieve`/`rotate`/`delete` call, extending the existing Audit
  Trail, batched so `retrieve()` (called on every pipeline run) doesn't spam logs.
- An **optional, low-priority** "Launch in KeeperDB" deep link from the Connectors UI, for
  organizations that already use KeeperPAM to manage the underlying database — kept `[?]` open,
  not built by default (see Task #9).
- Tenant-isolation cross-reference (per this repo's established convention that every epic must
  address this, even if only by flagging).

### Out-of-Scope

- **Replacing Query Studio/AskData with KeeperDB's SQL editor or KeeperAI assistant.** KeeperAI's
  NL-to-SQL chat/autonomous/explain modes duplicate dataPlane's own AskData and Query Studio
  feature set exactly — there is no reason to integrate a second, competing NL-to-SQL assistant
  into this platform.
- **Rebuilding or embedding the KeeperDB desktop client.** dataPlane's Query Studio already serves
  the in-browser SQL-editor need; KeeperDB is a separate desktop app with no public API to embed.
- **KeeperPAM's privileged-session recording/keystroke capture.** That's a human-DBA-access control
  concern (parallel to, not a replacement for, dataPlane's own Audit Trail, which already logs
  every query dataPlane itself executes). Not needed for this epic's scope of *dataPlane's own
  service-to-database* credentials.
- **Adding MSSQL/Redshift as new dataPlane connector types.** KeeperDB happening to support those
  engines is unrelated to whether dataPlane adds SQLAlchemy/driver support for them — that's an
  independent connector-catalog task (see `connector_tasks/03`), not part of vaulting.
- **Reopening the `connector_tasks#2` decision itself with a forced answer.** This epic presents
  KSM as one concrete, well-evidenced option for that pending sign-off — it does not unilaterally
  decide "external vault" over "self-hosted AES-256-GCM" without explicit approval (Task #2 below).
- **A general-purpose secrets manager for non-connector secrets** (e.g. `OLLAMA_*`, `SECRET_KEY`).
  Scoped strictly to database connector credentials, matching `connector_tasks#2`'s original scope.

---

## 4. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Sign off on KSM vs. self-hosted AES-256-GCM vs. other vault (Task #2) |
| Security | _TBD_ | Credential-handling sign-off (same gate `connector_tasks#2` already required) |
| Tech Lead | _TBD_ | `SecretManager` interface shape, KSM adapter boundary |
| Backend Engineer | _TBD_ | `secret_manager.py`, KSM adapter, `ConnectionService` wiring, backfill |
| DevOps | _TBD_ | KSM one-time-token bootstrap, docker-compose/env wiring |
| QA Engineer | _TBD_ | Verification, circuit-breaker/outage behavior, no-plaintext-leak tests |

---

## 5. Functional Requirements

- **FR1:** The platform shall expose a `SecretManager` interface (`store`/`retrieve`/`rotate`/
  `delete`) exactly as specified in `connector_tasks/02_secret_manager_integration.md`, independent
  of which backend implements it.
- **FR2:** A `KeeperSecretsManagerBackend` implementation shall store and retrieve connector
  credentials via the `keeper-secrets-manager-core` SDK, configured entirely through environment
  variables / `Settings` — no hardcoded tokens or config paths.
- **FR3:** `ConnectionService.create_connection()` shall extract known secret fields (per the
  per-type mapping in `connector_tasks#2`) and store them via the `SecretManager`, never leaving
  them in the `config` JSON column going forward.
- **FR4:** `ConnectionService.get_connection()` / `GET /connectors/{id}` shall never return secret
  values — the existing `redact_config` behavior continues to apply regardless of backend.
- **FR5:** Existing connections with plaintext secrets in `config` shall be migrated exactly once,
  via an explicit startup step or admin-triggered endpoint — never as a side effect of a `GET`.
- **FR6:** Credential rotation (`connector_tasks#8`) shall delegate to KSM's centralized rotation
  where the backend is KSM — dataPlane calls `rotate()` and re-fetches, rather than re-implementing
  rotation logic per connector type.
- **FR7:** Every `store`/`retrieve`/`rotate`/`delete` call shall emit an audit event (actor,
  connection id, timestamp, outcome) without ever logging the secret value itself.
- **FR8:** A KSM outage shall degrade gracefully (circuit breaker opens; connection metadata reads
  still work; only credential-dependent operations — e.g. running a pipeline against that
  connection — fail with a clear, actionable error) rather than taking down unrelated features.
- **FR9:** SQLite connections (no secrets) shall continue to work with no `SecretManager` call and
  no `ConnectionSecret`/vault record created for them.

---

## 6. Non-Functional Requirements

- **Security:** No secret value ever appears in logs, HTTP responses (including 422 validation
  echoes), or stdout, under any backend. This is the same bar `connector_tasks#2` already set —
  this epic does not lower it.
- **Reliability:** Reuse `backend/app/core/circuit_breaker.py` for all KSM calls, matching the
  existing Ollama-call pattern — no second circuit-breaker implementation.
- **Performance:** `retrieve()` is called on every pipeline run / connector use — cache within a
  request/task lifecycle where safe, and log at batched info-level, not per-column-access, per
  `connector_tasks#2`'s existing audit-requirement note.
- **Auditability:** Every vault operation is traceable in dataPlane's own Audit Trail without
  needing to cross-reference Keeper's own KSM access logs.
- **Operability:** KSM's one-time-token bootstrap and resulting config are handled the same way
  every other secret in this stack is — env var / mounted file, documented in `docker-compose.yml`,
  never committed.
- **Portability:** The `SecretManager` interface must not leak KSM-specific types into
  `ConnectionService` or the router layer — a future third backend (or a return to self-hosted
  AES-256-GCM) must be a pure swap-in, per `connector_tasks#2`'s original design intent.

---

## 7. Task Breakdown / Subtasks

See `keeperdb_integration_tasks/INDEX.md` for the full task list (11 tasks), confidence notes,
execution order, and progress log.

---

## 8. Acceptance Criteria

**AC1 — Interface exists and is backend-agnostic**
- **Given** `backend/app/services/secret_manager.py`
- **When** any connector service code calls `store()`/`retrieve()`/`rotate()`/`delete()`
- **Then** it does so purely through the abstract interface, with zero KSM-specific imports or
  types outside the KSM adapter module.

**AC2 — New connections never store plaintext secrets**
- **Given** a new connection created with a `password` field
- **When** `POST /connectors/` is called
- **Then** the password is stored via the `SecretManager`, `config` holds no secret value, and
  `secrets_ref` is populated.

**AC3 — Existing connections are migrated exactly once, explicitly**
- **Given** a pre-existing connection with a plaintext secret in `config`
- **When** the backfill step runs (startup or admin-triggered endpoint)
- **Then** the secret moves to the vault, `config` is cleared of the secret value, and re-running
  the backfill is a no-op (idempotent).

**AC4 — Rotation delegates to the vault**
- **Given** a connection whose secret needs rotation
- **When** `rotate_credentials()` is called
- **Then** it updates the value via `SecretManager.rotate()` and the connector's next use picks up
  the new value with no manual re-entry elsewhere.

**AC5 — KSM outage degrades gracefully**
- **Given** KSM is unreachable
- **When** any dataPlane feature that needs a credential is exercised
- **Then** the circuit breaker opens, the failing operation returns a clear error, and unrelated
  dataPlane functionality (e.g. viewing connection metadata, Schema Intel on already-cached
  schemas) is unaffected.

**AC6 — Every vault operation is audited, with no plaintext leakage**
- **Given** any `store`/`retrieve`/`rotate`/`delete` call
- **When** it completes (success or failure)
- **Then** an audit event is recorded, and no test or manual check finds the secret value in logs,
  responses, or audit payloads.

**Checklist**
- [ ] `SecretManager` interface implemented per `connector_tasks#2`'s spec.
- [ ] `KeeperSecretsManagerBackend` implemented with circuit breaker reuse.
- [ ] `ConnectionService` wired to the abstraction (create/get/update/delete).
- [ ] Explicit, idempotent backfill migration implemented and tested.
- [ ] Credential rotation delegates to KSM.
- [ ] Docker/env wiring for KSM bootstrap token, documented, no hardcoded secrets.
- [ ] Audit events emitted for every vault operation.
- [ ] Tenant-isolation cross-reference recorded.
- [ ] Security sign-off obtained on the backend choice (Task #2) before this ships to production.

---

## 9. Dependencies

**Internal:** `connector_tasks#1` (data model — `secrets_ref` column, already done),
`connector_tasks#2` (this epic implements its design and resolves its blocked decision),
`connector_tasks#8` (rotation — this epic unblocks it), `backend/app/core/circuit_breaker.py`,
`backend/app/core/config.py` (`Settings`), Audit Trail, the still-unresolved Tenant Isolation
architecture decision.
**External:** Keeper Secrets Manager (`keeper-secrets-manager-core`, MIT-licensed, PyPI) — either
Keeper's hosted cloud vault or a self-hosted KSM gateway, per Task #2's decision.

---

## 10. Assumptions

- The org either already has, or is willing to provision, a Keeper Secrets Manager tenant
  (hosted or self-hosted) — this epic does not include standing up Keeper's own infrastructure
  from scratch beyond the documented KSM client bootstrap.
- KSM's zero-knowledge architecture and centralized-rotation model are an acceptable trade
  against the "zero external infrastructure" simplicity of the self-hosted AES-256-GCM option —
  flagged as an explicit decision (Task #2), not silently assumed.
- The "Launch in KeeperDB" deep link (Task #9) only makes sense if the org's DBAs actually use
  KeeperPAM day-to-day for privileged database access — not assumed true, kept `[?]`.

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| This epic silently becomes the forced answer to `connector_tasks#2`'s pending decision without real sign-off | High | Task #2 stays an explicit `[!]` gate; the interface (Task #1) is built regardless and is backend-swappable |
| KSM outage blocks pipeline runs / connector operations platform-wide | Medium | Circuit breaker (reuse existing class); metadata-only reads (list connections, view non-secret config) must not require a live vault call |
| Backfill migration runs twice or races under concurrent requests | Medium | Idempotent design per `connector_tasks#2`'s corrected note — startup-step-only or `INSERT ... ON CONFLICT` |
| Secret value leaks via logs, 422 echo, or audit payload | High | Explicit test coverage asserting no plaintext appears in any of the three surfaces, mirroring `connector_tasks#2`'s existing risk mitigation |
| Vendor lock-in to Keeper if the interface isn't kept clean | Medium | `SecretManager` interface must not leak KSM-specific types outside its adapter module (NFR: Portability) |
| Tenant isolation gap extends into vault-scoped secrets | High | Cross-reference the existing deferred decision (Task #10), don't bypass it |

---

## 12. Technical Notes

- **New service:** `backend/app/services/secret_manager.py` — the abstract `SecretManager`
  interface, exactly as specified in `connector_tasks/02_secret_manager_integration.md` §"Secret
  manager abstraction."
- **New adapter:** `backend/app/services/keeper_secrets_manager_backend.py` — wraps
  `keeper-secrets-manager-core` (PyPI, MIT license, Python 3.9–3.13 — compatible with this repo's
  `.venv` runtime). Uses Keeper Notation (`get_notation("<record_uid>/field/password")`) to fetch
  individual credential fields; `store`/`rotate` create/update records via the SDK.
- **New config:** `Settings` gains `SECRET_MANAGER_BACKEND` (`"aes256"` | `"keeper"`, default
  `"aes256"` until Task #2 sign-off flips it), `KSM_CONFIG_PATH` (mounted config-file path, not a
  literal token) — matching the `OLLAMA_*` settings' existing env-var-sourced shape.
- **Docker:** KSM's one-time-token bootstrap produces a local config file; mount it as a Docker
  secret / bind-mounted file with restricted permissions, never bake it into an image layer or
  commit it — consistent with this repo's Docker-first, non-root, no-hardcoded-secrets rules.
- **Circuit breaker:** instantiate one named breaker for KSM calls via the existing
  `CircuitBreaker` class, following the exact pattern already used for Ollama calls.
- **Sources consulted (2026-07-14):**
  - [Secure Database Access with KeeperDB](https://www.keepersecurity.com/keeperdb/)
  - [What is KeeperDB?](https://www.keepersecurity.com/blog/2026/07/07/what-is-keeperdb/)
  - [KeeperDB | KeeperPAM and Secrets Manager | Keeper Documentation Portal](https://docs.keeper.io/keeperpam/privileged-access-manager/keeperdb)
  - [KSM Developer SDKs | Keeper Documentation Portal](https://docs.keeper.io/keeperpam/secrets-manager/developer-sdk-library)
  - [Python SDK | Keeper Documentation Portal](https://docs.keeper.io/keeperpam/secrets-manager/developer-sdk-library/python-sdk)
  - [keeper-secrets-manager-core · PyPI](https://pypi.org/project/keeper-secrets-manager-core/)
  - [GitHub — Keeper-Security/secrets-manager](https://github.com/Keeper-Security/secrets-manager)

---

## 13. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration tests passing, including simulated-outage circuit-breaker behavior and
      no-plaintext-leak assertions.
- [ ] FR1–FR9 implemented and verified.
- [ ] Security sign-off on the vault-backend choice and the tenant-isolation cross-reference.
- [ ] Acceptance criteria met.
- [ ] Documentation updated; `MEMORY.md` and this epic's `INDEX.md` progress log current.
