# Keeper Secrets Manager Integration (DP-KSM-001) — Task Index

> Source: `requirements-specs-v5/TRD_DataPlane_KeeperDB_Secrets_Vault_Integration.md`.
> Origin: user asked how **KeeperDB** ("database management tool for Postgres, MySQL, SQLite,
> MSSQL, Oracle, Redshift") could be leveraged here. KeeperDB itself is a desktop GUI client with
> no public API — the actual integrable product is its sibling, **Keeper Secrets Manager (KSM)**,
> an open-source-SDK vault product. This epic implements the `SecretManager` abstraction that
> `requirements-specs/connector_tasks/02_secret_manager_integration.md` already designed but never
> built, and adds KSM as a concrete external-vault backend — resolving that task's `[!]`-blocked
> decision (open since 2026-07-06).

## Why this is additive to, not a reinvention of, existing infra

`connector_tasks#2` already designed the `SecretManager` interface (`store`/`retrieve`/`rotate`/
`delete`) and explicitly called out "Implementation #2 (future): External vault (HashiCorp Vault,
AWS Secrets Manager, etc.)" as a swap-in target, gated behind a human sign-off on which backend to
use. That interface was never built in code (confirmed: no `secret_manager.py` exists in
`backend/app/` as of this audit). This epic is that build, with KSM as the proposed backend. It
does not touch `connector_tasks#1`'s data model (already done — `secrets_ref` column exists) or
invent a new governance/approval pattern.

## Design decisions & edge cases (read before implementing any task below)

1. **The interface ships regardless of the backend decision.** Per `connector_tasks#2`'s own note,
   "the abstraction layer design ... is safe to build and review regardless of which
   implementation is chosen." Task #1 (interface) is not gated behind Task #2 (backend sign-off) —
   only the KSM adapter and its wiring are.
2. **This epic proposes an answer, it doesn't unilaterally decide.** `connector_tasks#2` is the
   *seventh* place in this repo where the pattern is "gate the highest-risk decision behind an
   explicit `[!]` blocked task" (mapper tenant isolation, schema intel PII/tenant isolation,
   Pipelines execution semantics and secret vaulting, connectors' own #2). This epic's Task #2 is
   that same gate, now with a concrete, evidenced option (KSM) instead of an abstract "external
   vault, TBD which one."
3. **KeeperDB (the GUI) is out of scope; KSM (the vault) is in scope.** Don't conflate the two —
   KeeperDB has no documented API to integrate against; KSM does (`keeper-secrets-manager-core`,
   MIT, PyPI). The optional "Launch in KeeperDB" deep link (Task #9) is a separate, much smaller,
   `[?]`-gated idea for human DBA convenience, not a dependency of the vaulting work.
4. **Reuse the existing circuit breaker, don't build a second one.** `backend/app/core/
   circuit_breaker.py` already exists for exactly this class of problem (Ollama calls degrading
   gracefully). KSM calls get the same treatment.
5. **Rotation should shrink, not grow, dataPlane's own code.** `connector_tasks#8` (credential
   rotation) is currently blocked on #2. Once KSM is the backend, rotation becomes "call
   `SecretManager.rotate()` and re-fetch" — dataPlane does not need to build its own rotation UI
   logic per connector type; KSM's own centralized rotation ("rotate once, everyone gets it") does
   that job.
6. **No new credential surface for non-connector secrets.** `OLLAMA_*`, `SECRET_KEY`, etc. stay
   exactly as they are today (env vars via `Settings`). This epic is scoped strictly to database
   connector credentials, matching `connector_tasks#2`'s original scope — don't let it quietly grow
   into "dataPlane's general secrets manager."
7. **Backfill is explicit and idempotent, never an implicit side effect.** `connector_tasks#2`
   already corrected an earlier draft that triggered migration on a `GET` (not idempotent, not
   side-effect-free). This epic's backfill task (#5) follows that correction exactly: a startup
   step or a dedicated admin endpoint, not a lazy migration on read.
8. **Tenant isolation is out of scope to solve here — cross-reference, don't ignore (Task #10).**
   This is the ninth epic in this repo to hit this same unresolved architecture gap.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Title | Status | Depends on |
|---|---|---|---|
| [01](01_secret_manager_abstraction.md) | `SecretManager` abstract interface | [x] | — |
| [02](02_vault_backend_decision.md) | Vault backend decision — KSM vs. self-hosted AES-256-GCM vs. other | [x] | — |
| [03](03_ksm_backend_adapter.md) | `KeeperSecretsManagerBackend` adapter (KSM SDK + circuit breaker) | [x] | #1, #2 |
| [04](04_connection_service_wiring.md) | Wire `ConnectionService` to the `SecretManager` abstraction | [x] | #1, #3 |
| [05](05_secret_backfill_migration.md) | One-time, idempotent backfill of plaintext secrets | [x] | #4 |
| [06](06_credential_rotation_via_ksm.md) | Credential rotation delegated to KSM | [x] | #3, #4 |
| [07](07_docker_env_wiring.md) | Docker/env wiring for KSM bootstrap token | [x] | #2 |
| [08](08_audit_logging_integration.md) | Audit events for every vault operation | [x] | #4 |
| [09](09_launch_in_keeperdb_deeplink.md) | Optional: "Launch in KeeperDB" deep link from Connectors UI | [?] | — |
| [10](10_tenant_isolation_signoff.md) | Tenant-isolation cross-reference | [!] | #4 |
| [11](11_tests_and_verification.md) | Tests + circuit-breaker/outage/no-plaintext-leak verification | [x] | #1–#8 |

## Confidence per task (auto-mode implementation)

- **#1 Interface** — HIGH confidence. It's a direct transcription of `connector_tasks#2`'s already-
  reviewed design; no new decisions to make.
- **#2 Backend decision** — **`[!]` blocked.** Same class of decision `connector_tasks#2` already
  gated — self-hosted AES-256-GCM (zero external infra) vs. KSM (external vault, zero-knowledge,
  built-in rotation) is a real compliance/cost/ops trade-off that shouldn't be auto-decided.
  Recommendation: KSM, given it directly closes a gap this repo already flagged as its highest-
  priority security task — but flagged for explicit sign-off, not auto-chosen.
- **#3 KSM adapter** — HIGH confidence once #2 is resolved. Mechanical wrapper + reuse of an
  existing circuit-breaker class + a well-documented SDK.
- **#4 ConnectionService wiring** — HIGH confidence — the exact field-by-field plan already exists
  in `connector_tasks#2`; this task executes it against the new abstraction.
- **#5 Backfill migration** — MEDIUM-HIGH confidence. Mechanical, but idempotency and the
  startup-vs-endpoint choice need care (see design decision #7 above) — the exact mistake
  `connector_tasks#2` already caught once in an earlier draft.
- **#6 Rotation via KSM** — HIGH confidence once #3/#4 exist — thinner than a from-scratch rotation
  implementation because KSM owns the actual rotation logic.
- **#7 Docker/env wiring** — HIGH confidence, mechanical, follows existing patterns in
  `docker-compose.yml` and `Settings`.
- **#8 Audit events** — HIGH confidence, follows the established `emit_audit_event` /
  `record_audit` pattern already used throughout `connectors.py`.
- **#9 Launch-in-KeeperDB deep link** — **`[?]` open.** Only valuable if the org already runs
  KeeperPAM for DB access; building it speculatively risks a dead UI affordance. Needs product
  confirmation before scoping further.
- **#10 Tenant isolation** — **`[!]` blocked**, same as every other epic that's hit this gap in
  this repo (mapper, schema intel, connectors, dashboard, autopilot, the Agentic DBA Copilot epic,
  the ACI.dev epic, now this one).
- **#11 Tests + verification** — MEDIUM confidence. The circuit-breaker/outage test and the
  no-plaintext-leak assertions are the actual proof of the Security NFR — the ones most likely to
  be under-scoped if rushed.

## Execution order (in auto mode)

1. **#1 Interface** — build first; unblocked, foundation for everything else.
2. **#2 Backend decision** — raise for sign-off immediately in parallel with #1; blocks #3, #6, #7.
3. **#3 KSM adapter** — once #2 is resolved.
4. **#4 ConnectionService wiring** — depends on #1 and #3.
5. **#5 Backfill migration** and **#6 Rotation via KSM** — both depend on #4; can proceed in
   parallel.
6. **#7 Docker/env wiring** — depends only on #2; can proceed in parallel with #3/#4.
7. **#8 Audit events** — incremental, integrated alongside #4/#5/#6 as they land, not held to the
   end in practice despite the dependency line above.
8. **#9 Launch-in-KeeperDB** — independent; pursue only after product confirms KeeperPAM adoption,
   stays `[?]` regardless of timing.
9. **#10 Tenant isolation** — pursue in parallel once #4 exists enough to review concretely; stays
   `[!]` regardless of timing.
10. **#11 Tests + verification** — last, closing out the epic.

## Out of scope (confirmed, per TRD §3)

- Replacing Query Studio/AskData with KeeperDB's SQL editor or KeeperAI assistant.
- Rebuilding or embedding the KeeperDB desktop client.
- KeeperPAM's privileged-session recording/keystroke capture.
- Adding MSSQL/Redshift as new dataPlane connector types (unrelated to vaulting).
- A general-purpose secrets manager for non-connector secrets (`OLLAMA_*`, `SECRET_KEY`, etc.).

## Progress log

- 2026-07-14 — Epic scoped after researching what KeeperDB actually is (desktop GUI client, no
  public API) versus its sibling Keeper Secrets Manager (open-source Python SDK, real integration
  surface). Cross-referenced against `requirements-specs/connector_tasks/02` and confirmed via
  direct repo inspection that `secret_manager.py` does not exist yet, `connections.config` still
  holds secrets in plaintext pending that task's blocked decision, `cryptography==42.0.5` is
  already a dependency (for the self-hosted alternative), and no vault SDK is in
  `backend/requirements.txt` today. TRD + INDEX.md created, 11 tasks defined. Not started.
- 2026-07-14 — **Task #2 decision RESOLVED by repo owner (explicitly asked, not auto-decided):
  BOTH backends, aes256 default.** Self-hosted AES-256-GCM ships as the working default (zero
  external infrastructure, fully testable locally); the KSM adapter ships behind
  `SECRET_MANAGER_BACKEND=keeper` (SDK-mocked in tests). The production posture stays revisitable
  without touching connector code — exactly the swap-in property `connector_tasks#2`'s interface
  design existed to preserve.
- 2026-07-14 — **Tasks #1, #3–#8, #11 built and verified** (single build session; #9 stays `[?]`,
  #10 stays `[!]`).
  - **#1 done.** `secret_manager.py` — the ABC exactly per `connector_tasks#2`'s design
    (store/retrieve/rotate/delete), plus `get_secret_manager()` (the ONLY backend-choice branch
    point) and `secret_manager_enabled()`. One deliberate signature addition vs. the original
    sketch: an optional `db` session param so a locally-persisting backend can join the caller's
    transaction (a failed connection create can't orphan a vault row).
  - **#3 done (both backends).** `aes_gcm_secret_manager.py`: AES-256-GCM via the `cryptography`
    lib, random 12-byte nonce, ciphertext in the new `connection_secrets` table (separate from
    `connections` for defense-in-depth, unique per connection), `key_id` = first 8 hex of
    SHA-256(key) (an identifier, never key material), `SECRETS_ENCRYPTION_KEY_PREVIOUS` gives a
    key-rotation window, lost-key reads fail with a clear no-value error.
    `keeper_secrets_manager_backend.py`: wraps `keeper-secrets-manager-core==17.0.0` (installed;
    `RecordCreate`/`RecordField`/`get_secrets`/`save`/`delete_secret` surface verified against the
    real package) behind a named `CircuitBreaker("keeper")` + backoff retries; refs
    `keeper://<record_uid>`, stable across rotation ("rotate once, everyone re-fetches").
  - **#4 done.** `connection_secrets_service.py` glue + `ConnectionService.create_connection`
    extracts secret fields (same per-type mapping `redact_config` already trusts) into the vault;
    `get_connector` resolves them back via `resolve_connection_config` — the single
    credential-resolution point, so a vault outage breaks ONLY credential-dependent operations
    (metadata reads never pass through it — proven by tests). Hard delete removes the vault entry;
    soft delete retains it so restore works. **Legacy mode is explicit:** unset key/config keeps
    secrets in `config` (responses still redacted) with a once-per-process warning — existing
    deployments don't break the moment this ships.
  - **#5 done.** `POST /connectors/migrate-secrets` (admin-only): explicit, idempotent backfill —
    rows with `secrets_ref` or no secret fields are skipped; re-run is a no-op; the
    `connection_secrets` unique constraint backs race-safety; 409 when the vault isn't configured.
    Never a side effect of a GET (connector_tasks#2's corrected design followed exactly).
  - **#6 done — unblocks `connector_tasks#8`'s rotation half.** `POST
    /connectors/{id}/rotate-credentials` (admin): merges new secret fields over existing vault
    values via `rotate()`; a legacy (unmigrated) row is migrated by the same code path the
    backfill uses (one implementation, per connector_tasks#2's note); sqlite → clear 422 ("no
    credential fields"); unknown fields → 422; body validated manually so malformed requests
    can't bounce secret values back in a FastAPI 422 echo; responses carry field NAMES only.
  - **#7 done.** `Settings`: `SECRET_MANAGER_BACKEND` (default aes256), `SECRETS_ENCRYPTION_KEY`
    (+`_PREVIOUS`), `KSM_CONFIG_PATH` (mounted file path, never a literal token), `KSM_FOLDER_UID`.
    docker-compose env passthrough (no baked-in key), `.env.example` documented
    (`openssl rand -base64 32`), `.gitignore` covers `ksm_config*.json`. `docker compose config`
    valid.
  - **#8 done.** `module=secrets` audit events: `secrets.secret_store` / `secret_rotate` /
    `secret_delete` per operation, `secrets.secret_retrieve` batched via a 60s TTL cache per
    connection (retrieve fires per column during profiling — one audit per logical window, not
    per call, per connector_tasks#2's spam note). Payloads carry field NAMES/backend/refs — never
    values (asserted against serialized payloads in tests).
  - **#11 done (automated half).** 40 tests in `tests/secrets/`: AES roundtrip/rotation/key-window/
    lost-key/upsert; Keeper adapter roundtrip/stable-ref/circuit-opens-and-fails-fast/unconfigured;
    wiring (create vaults + strips config, GET stays redacted, sqlite never touches the vault,
    legacy mode preserved, resolve feeds real connector construction, soft-vs-hard delete);
    backfill idempotency + role gate; rotation incl. legacy-migration path + no-echo;
    **no-plaintext-leak sweep** (create/GET/list/422-echo/rotate/migrate/delete × response bodies +
    DEBUG-level caplog + serialized audit payloads, all grepped for the literal secret);
    **outage behavior** (dead vault / open keeper circuit → metadata endpoints all 200, only
    `get_connector` fails, clearly). **Honest caveats:** (1) the KSM adapter is verified against a
    mocked SDK boundary — a live pass against a real Keeper tenant (one-time-token bootstrap,
    actual record create/rotate) remains open and is the final acceptance bar for the keeper
    backend; (2) `connector_tasks#2/#8` can now be marked resolved-by-cross-reference, but their
    own INDEX rows should be updated when that epic is next touched.
  - Verification: `pytest tests/secrets/` 40/40; full backend suite run recorded below;
    `docker compose config` valid.
- 2026-07-14 — **Full-suite regression pass:** entire backend `pytest tests/` 796/796 green
  (includes all pre-existing suites: connectors 260-series, mapping, pipelines, schema_catalog,
  audit, autopilot, security, semantic, viz — none regressed by this session's three epics).
  Frontend: `tsc --noEmit` clean, `vitest run` 125/125, `next build` clean, `next lint` zero new
  issues. One session-discovered gotcha worth knowing: a live local Ollama makes plan-generation
  tests nondeterministic — `tests/agentic_dba/conftest.py` pins `AGENTIC_DBA_LLM_ENABLED=False`
  and the LLM path has its own mocked-boundary tests instead.
- 2026-07-15 — Post-build validation found and fixed two v5 defects; full details are in
  `bugs.md`. Removed `tests/secrets/__init__.py`, which shadowed Python's standard-library
  `secrets` module and broke pytest collection on Python 3.13. Hardened partial credential
  rotation to fail closed when the existing vault record cannot be read, preventing a vault
  outage/lost key from erasing unsubmitted credential fields; added a regression test. Targeted
  v5 suite: 41/41. Open follow-ups are recorded in `enhancements.md`.
