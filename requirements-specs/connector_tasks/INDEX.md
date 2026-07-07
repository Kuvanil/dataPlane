# Connectors (DP-CONN-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Connectors.md` (9 FRs, 9 subtasks, ~24 days estimated = 4–5 weeks).
> Scope: backend `/api/v1/connectors/*` + secret vault integration + health-check scheduler + frontend connector forms + audit + tests.
>
> **2026-07-06 audit:** The codebase has a working foundation — `DBConnection` model (`backend/app/models/connection.py`),
> `connectors.py` router (`backend/app/api/routers/connectors.py`) with create/list/get/delete/test/get_schema,
> `BaseConnector` abstraction (`backend/app/connectors/base.py`) plus MySQL/Postgres/Oracle/SQLite/JDBC implementations,
> and basic `record_audit` calls on create/delete/test. What's **missing** from the TRD:
>
> - Secret-manager integration (credentials stored in plaintext JSON today — **security risk**)
> - Health-check scheduler
> - `PUT` update endpoint + credential rotation
> - Connector types catalog API (`GET /connectors/types`)
> - Dynamic forms metadata per connector type
> - Soft delete with dependency-awareness (hard delete today, no dependency checks)
> - Explicit schema discovery handoff endpoint
> - Health status tracking on the model
> - Test diagnostics beyond pass/fail (no error message or failure reason)
> - Frontend connector management UI
> - Proper test suite
>
> **FR1–FR9 verdict (as of 2026-07-06 audit):**

| FR | Requirement | Verdict (updated 2026-07-07, landed+tested code only) | Task(s) |
|----|-------------|---------|---------|
| FR1 | List available connector types with metadata | **DONE** — `GET /connectors/types` + `/types/{type}` from `connector_catalog.py` registry | #3 |
| FR2 | Create connection by selecting type + parameters | **DONE** — create validates config against the type's `FieldDef`s (required/number/select, unknown keys stripped) | #1, #3 |
| FR3 | Credentials in secret manager, never returned to client | **PARTIAL** — the "never returned" half is done (all responses redact secret fields via `redact_config`, incl. URL-embedded creds; all read endpoints now auth-gated — they were previously open and leaked plaintext passwords). The "stored in vault" half remains blocked on #2's sign-off; config still holds secrets at rest | #2 |
| FR4 | Test Connection with pass/fail + diagnostic detail | **DONE** — structured diagnostics (reachable/auth/db/version/latency), error classification, 5s hard timeout (`CONNECTOR_TEST_TIMEOUT_SECONDS`) | #4 |
| FR5 | Live health status for each saved connection | **DONE** — `health_status`/`last_tested_at`/`last_test_error` columns, beat-scheduled checks every 5 min (rate-limited 10/m), `GET /connectors/health-summary` | #5 |
| FR6 | Edit non-secret fields + rotate credentials | NOT DONE (blocked chain: #8 depends on #2) | #8 |
| FR7 | Soft-delete with dependency flagging | **DONE** — two-step confirm flow, dependent pipelines disabled, restore + admin-only hard delete (blocked while dependents exist), partial unique index allows name reuse. Caveat: `Mapping` has no status field to flag, so affected mappings are recorded in the audit payload only | #7 |
| FR8 | Trigger schema discovery handoff on demand | **DONE** — `POST /connectors/{id}/discover`: SchemaSnapshot + best-effort `SchemaCatalogService.scan_connection` handoff | #6 |
| FR9 | Audit events for create/edit/delete/test/rotate | **PARTIAL** — create/delete/test/restore/hard-delete/discover all audited with real actor; edit/rotate don't exist yet (#8) | #7, #8 |

**6 of 9 FRs done; FR3/FR9 partial (blocked on #2's sign-off); FR6 not done (same chain).**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_connection_data_model.md) | FR2, FR5, FR7, §11 | [x] | Connection data model upgrade — health, soft-delete, secrets_ref, audit columns + `ConnectionService` (tenant_id left out per decision box, option 1 by default until owner picks) |
| [02](02_secret_manager_integration.md) | FR3, FR6, Security NFR | [!] | Secret manager integration for credential vaulting — **blocked pending sign-off on encryption approach**. Interim mitigation shipped 2026-07-07: response-layer redaction + auth-gated reads (see FR3 row) |
| [03](03_connector_catalog_types.md) | FR1 | [x] | Connector types catalog + dynamic form metadata + boundary validation |
| [04](04_test_connection_with_diagnostics.md) | FR4, Performance NFR | [x] | Test Connection with enhanced diagnostics + timeout (rewrote base.py + all 5 connectors as scoped) |
| [05](05_health_check_scheduler.md) | FR5, Reliability NFR | [x] | Health check scheduler with status tracking (beat + rate-limited fan-out + health-summary endpoint) |
| [06](06_discovery_handoff.md) | FR8 | [x] | Schema discovery handoff to Schema Intel |
| [07](07_dependency_aware_soft_delete.md) | FR7, §10 risk table | [x] | Dependency-aware soft delete with warnings (+ restore, admin hard delete, deleted list) |
| [08](08_update_and_credential_rotation.md) | FR6, FR9 | [!] | Update connection + credential rotation + audit — blocked on #2 (rotation needs the secret store) |
| [09](09_connector_tests.md) | §12 DoD | [~] | Test suite — 69 tests landed covering tasks #1/#3/#4/#5/#6/#7 (suite 260/260 green); secret-manager + rotation test modules pending #2/#8 |
| [10](10_tenant_isolation_signoff.md) | §9 assumption / DoD | [!] | Tenant isolation — cross-reference, not a new task |

## Confidence per task (auto-mode implementation)

- **#1 Data model upgrade** — HIGH confidence for `health_status`, soft-delete columns, `secrets_ref`, audit fields — extends the existing model mirroring the established pattern. **`tenant_id` is gated** (see decision box in the task file) pending the same sign-off `mapper_tasks/07`/`schema_intel_tasks/09` already required for this exact column elsewhere — do not implement it as a routine part of this task.
- **#2 Secret manager integration** — **[!] blocked.** Design choice (self-hosted AES-256-GCM envelope encryption vs. mandatory external vault from day one) needs explicit sign-off before implementation, per this repo's established pattern for exactly this class of decision (see the task file's decision box). The abstraction layer (the `SecretManager` interface) can be designed/reviewed now; only the concrete "Implementation #1" is gated.
- **#3 Connector catalog types** — HIGH confidence. Static metadata dict per connector type, no external dependencies. Mechanical. (Corrected 2026-07-06 to use Pydantic `BaseModel` instead of a bare `@dataclass`, matching every other schema file in this codebase.)
- **#4 Test Connection with diagnostics** — MEDIUM-HIGH confidence, revised down from HIGH (2026-07-06): all 5 connectors already override `test_connection()` with their own bool-returning implementation, so this task touches 6 files (`base.py` + all 5 connectors), not just 1 — see the scope correction in the task file. The diagnostic/timeout logic itself remains mechanical.
- **#5 Health check scheduler** — MEDIUM confidence. Celery periodic task (matching existing pattern in `backend/app/tasks/ai_tasks.py`) + model update. Edge cases around concurrent health checks for the same connection are the main risk. (Corrected 2026-07-06: the task's `get_connector()` call was fixed to match the real signature — see task file.)
- **#6 Discovery handoff** — MEDIUM confidence. Depends on Schema Intel's catalog scan endpoint existing (`POST /api/v1/catalog/scan/{connection_id}`) — confirmed this endpoint now exists (`schema_intel_tasks/01`, implemented 2026-07-06), so this task is unblocked on that front.
- **#7 Soft delete** — MEDIUM confidence. Dependency checks need cross-model queries against Mappings and Pipelines. (Corrected 2026-07-06: the task's field references were wrong — `Mapping` uses `source_id`/`target_id` and has no `is_deleted`; `Pipeline` genuinely uses `source_connection_id`/`target_connection_id` but also has no `is_deleted`, only `enabled`. Also corrected two `require_role()` call sites that used it as a plain function instead of the FastAPI dependency factory it actually is.) Graceful degradation for a missing Pipeline model is no longer needed — confirmed `Pipeline` now exists (built under `Pipelines_tasks`).
- **#8 Update + rotation** — HIGH confidence for update, MEDIUM for rotation. (Corrected 2026-07-06: `_test_credentials`' `get_connector()` call was fixed to match the real signature, and its backfill note now points at Task #2's corrected, single-source-of-truth migration function instead of re-describing separate backfill logic.)
- **#9 Tests** — MEDIUM confidence. Integration tests need either a real DB or well-mocked connector drivers. The existing `conftest.py` patterns suggest in-memory SQLite for model tests is fine; connector tests may need more sophisticated mocking.
- **#10 Tenant isolation** — **[!] blocked**, cross-reference to the same app-wide gap already flagged in `mapper_tasks/07` and `schema_intel_tasks/09`. Not re-litigated here.

## Execution order (recommended)

1. **#1 Data model upgrade** — foundation: health status, soft-delete columns needed by several downstream tasks. Leave `tenant_id` out until Task #10's decision comes back.
2. **#3 Connector catalog types** — no dependencies, unblocks frontend forms.
3. **#4 Test Connection with diagnostics** — improves existing endpoint immediately; budget for all 6 files (see confidence note above).
4. **#2 Secret manager integration** — **stop here for sign-off** (see decision box) before writing code; needed before #8's rotation can land securely.
5. **#8 Update + rotation** — depends on #2 (secret manager) and #1 (updated model).
6. **#5 Health check scheduler** — depends on #1 (health_status fields) and #4 (diagnostic test).
7. **#6 Discovery handoff** — Schema Intel's scan endpoint now exists; no longer blocked on that.
8. **#7 Soft delete** — depends on #1 (soft_delete columns) and cross-model dependency checks; `Pipeline` model now exists so both dependency checks are live, not degraded.
9. **#9 Tests** — incremental, applied as each task's endpoints land.
10. **#10 Tenant isolation sign-off** — cross-team, pursue in parallel; don't block other tasks on it but don't mark the Security DoD checkbox satisfied without it either.

## Out of scope (confirmed, per TRD §2)

- Actual schema profiling/classification (owned by Schema Intel).
- Field mapping (owned by Schema Mapper).
- Data movement (owned by Pipelines).
- Building new connector driver types (treated as separate engineering tasks).

## Progress log

- 2026-07-06 — Initial audit against TRD. INDEX.md created with 9 task files. 0/9 FRs fully done.
- 2026-07-06 — **Principal-architect review of all 9 task files against actual code**, no
  implementation started yet. Found and fixed 4 critical spec bugs that would have failed
  immediately if implemented as written: (1) Task #7's dependency check referenced
  `Mapping.source_connection_id`/`target_connection_id`/`is_deleted`, none of which exist on the
  real model; (2) Task #7's admin-only endpoints called `require_role(_user, "admin")` as a plain
  function instead of the FastAPI dependency factory it actually is; (3) Tasks #5 and #8 both
  called `get_connector(conn.type)(config)`, but the real `get_connector(connection)` takes the
  whole ORM object, not a type string; (4) Task #4 understated its own scope — all 5 connectors
  already override `test_connection()`, so the "default implementation" change needed to touch 6
  files, not 1. Also found 2 governance conflicts with this repo's own established precedent:
  Task #1's `tenant_id` addition and Task #2's un-gated choice of encryption approach — both now
  gated pending explicit sign-off, matching how `mapper_tasks`/`schema_intel_tasks`/
  `Pipelines_tasks` treated their own equivalent decisions. Added Task #10 (tenant isolation
  cross-reference). Fixed 3 medium-severity design gaps in place (Task #5's Celery beat-schedule
  snippet wouldn't have actually registered; Task #1's "drop just the connections table" migration
  advice understated FK blast radius; Task #2's secret-backfill-on-GET violated GET idempotency
  and duplicated Task #8's rotation-time backfill) and 2 low-severity consistency nits (timestamp
  column convention, partial-unique-index SQLAlchemy syntax). No code implemented — all changes
  are to the task specs themselves.
- 2026-07-07 — **Tasks #1, #3, #4, #5, #6, #7 implemented and verified** (69 new tests in
  `backend/tests/connectors/`, full backend suite 260/260; frontend tsc/build clean, vitest
  35/35, lint 29 problems vs 30-problem HEAD baseline). What landed:
  - **#1** `DBConnection` gains `secrets_ref`, `health_status`, `last_tested_at`,
    `last_test_error`, `is_deleted`, `deleted_at`, `created_by`, `updated_by`, `updated_at`;
    unique-name constraint replaced by partial unique index `uq_connection_name_active`
    (`WHERE NOT is_deleted`) so soft-deleted names are reusable. New
    `services/connection_service.py` owns CRUD/health/dependents; router is thin. `tenant_id`
    deliberately NOT added (decision box, defaulted to option 1 pending owner call).
  - **#3** `services/connector_catalog.py` registry (5 types, FieldDefs, secret_fields) +
    `GET /connectors/types[/{type}]`; create now validates config per type (required fields,
    number coercion, unknown keys stripped); hardcoded `VALID_TYPES` removed.
  - **#4** `TestConnectionResult` dataclass + shared `classify_connection_error` in `base.py`;
    all 5 drivers' `test_connection()` rewritten (version + latency on success); psycopg2/pymysql
    get `connect_timeout=4`; `SchemaService.test_connection` wraps in a 5s ThreadPoolExecutor
    timeout and never raises; `POST /{id}/test` returns diagnostics + updates health + audits.
    SQLite driver no longer silently *creates* a missing DB file during a test (path checked).
  - **#5** `tasks/connector_tasks.py` (`run_all_health_checks` fan-out + per-connection task,
    `rate_limit=10/m`, retries w/ backoff) + beat entry every `HEALTH_CHECK_INTERVAL_MINUTES`
    (default 5) + `GET /connectors/health-summary`.
  - **#6** `POST /{id}/discover`: SchemaSnapshot (full SHA-256 of normalized schema) + best-effort
    handoff to `SchemaCatalogService.scan_connection`, both audited; degrades gracefully if the
    catalog scan fails.
  - **#7** Soft delete w/ two-step confirm (`?confirm=true`) when dependents exist; dependent
    pipelines get `enabled=False`; mappings recorded in audit payload only (no status field
    exists on `Mapping` — honest gap); `POST /{id}/restore` (409 on name reuse),
    `DELETE /{id}/hard` + `GET /connectors/deleted` admin-only via `require_role("admin")`;
    hard delete blocked while dependents exist.
  - **Beyond the task files (hotfix-class, FR3/security NFR):** the audit found `GET /connectors/`
    and `GET /{id}` returned plaintext passwords to *unauthenticated* callers. All connector
    endpoints now require auth, and every response serializes through `_to_response()` which
    redacts secret values (`***`, URL creds masked). Encryption-at-rest remains #2's scope.
  - **Consumers updated for soft-delete:** drift task, askdata context, dashboard connector KPI,
    and mapping/pipeline create-validation now filter `is_deleted == False`.
  - **Frontend (minimal alignment):** connectors page status badge now driven by real
    `health_status`/test results (was hardcoded "Connected"), test failures show the diagnostic
    message, and the mock-connector fallback rows were removed per the no-mock-UI rule.
  - **Live verification:** additive `ALTER TABLE` applied to the dev Postgres (no drop needed),
    api/worker/beat/frontend images rebuilt; exercised via curl: types, redacted list,
    401 on anonymous read, test diagnostics (SQLite connected w/ version+latency; Oracle
    CONNECTION_REFUSED w/ driver message), health-summary, discover (snapshot 271 + catalog scan
    3 tables/17 columns), dependent-delete warning (`requires_confirm` w/ 2 deps), scratch
    create→soft-delete→restore→hard-delete, audit rows present for every action. Beat had
    already populated real health statuses within minutes of restart.
  - **Caveats:** #2/#8 remain blocked on the encryption-approach sign-off (secrets still
    plaintext *at rest*); mapping-side flagging is audit-only; the dev-DB migration was manual
    SQL (this repo has no migration tool — fresh environments get the full schema from
    `create_all`, existing ones need the same additive ALTERs, recorded here).