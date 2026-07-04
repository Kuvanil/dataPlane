# Code Review Notes — Schema Mapper (DP-SM-001)

**Reviewer role:** Principal Architect / Senior Systems Engineer review, enterprise production bar.
**Scope reviewed:** `backend/app/services/mapping_service.py`, `mapping_validation_service.py`,
`transformation_grammar.py`, `app/models/mapping.py`, `app/schemas/mapping.py`,
`app/api/routers/mappings.py`, `app/workers/mapping_tasks.py`, `app/core/celery_app.py`,
`app/services/audit_helper.py`, `app/services/ai_service.py` (match_schemas),
`frontend/.../schema-mapper/*`, all of `backend/tests/mapping/*`,
`docs/mapper-mapping-contract.md`, `requirements-specs/TRD_DataPlane_Schema_Mapper.md`.

**Audience:** a developer agent that will pick up this document and implement fixes. Every
finding below cites exact file/line evidence — verify against current `HEAD` before patching,
since line numbers drift.

---

## 1. Executive Summary

- **Overall code quality: 6/10.** The module is well-organized, has real test coverage (unit +
  integration + E2E + contract tests), a genuinely restricted transformation grammar, and clean
  FastAPI/SQLAlchemy conventions. But it has **one production-breaking wiring bug**, **one
  silently-unimplemented functional requirement**, and **one latent SQL-injection surface** —
  none of which the test suite catches, because the test suite's own scaffolding (Celery eager
  mode, mocked schema fetch) papers over exactly the seams where the bugs live.
- **Key strengths:**
  - Transformation grammar (`transformation_grammar.py`) is a genuine allow-list DSL — no
    `eval`, no arbitrary code execution, clear per-kind schema validation.
  - Draft/publish state machine is coherent: immutable versions, `_assert_draft` guard,
    version pinning on export.
  - Audit coverage is broad — every mutating action calls `record_audit`.
  - Test suite has real breadth: service unit tests, router role-gating tests, a full E2E
    smoke test that walks the entire UI flow, and a dedicated contract test locking the
    export JSON shape to the published docs.
- **Critical concerns (see §11 for details):**
  1. The AI-suggestion Celery task is never registered with the real worker — FR4/FR5/AC2 are
     dead on arrival in the deployed stack.
  2. The "lossy warning" verdict required by FR7/AC3 is never produced — every lossy
     conversion is either silently passed or hard-blocked.
  3. Two transformation kinds (`cast.to`, `lookup.table/key_column/value_column`) build SQL by
     raw string interpolation with zero identifier validation, directly contradicting the
     published contract's promise that there is "no string interpolation of user data into SQL."
  4. `accept_suggestion` bypasses the many-to-many guard on an unverified assumption, so FR3
     can be violated through the AI-suggestion path.
  5. AI-suggestion generation cost scales with **target columns × source tables**, not
     **target tables × source tables** — an ~N× blow-up in LLM calls that breaks the stated
     performance NFR at the TRD's own target scale.
- **Production readiness: NOT READY.** The feature will demo fine (small schemas, `TASK_ALWAYS_EAGER`
  test mode, admin happy path) and fail in real deployment on the AI-suggestion flow specifically,
  plus ships a security hole that will detonate the moment Pipelines starts executing
  `compile_sql` output. Treat as **Approve with Required Changes**, not shippable as-is.

---

## 2. Architecture Review

- **Layering is correct and consistently applied:** router → service → validation/grammar →
  models. No business logic leaked into the router (`mappings.py` is a thin adapter, good).
- **Separation of concerns is mostly good** but the service layer does too much at once in a
  few places — `MappingService.publish` (mapping_service.py:396-467) does validation, schema
  snapshotting via a second service, version numbering, edge pinning, and audit emission all
  inline. Not wrong, but it means one method has five distinct failure modes with only a single
  generic `except Exception` around the schema-fetch step.
- **Coupling concern:** `MappingService` directly imports and calls `celery_app.send_task` by
  string name (mapping_service.py:274-277) instead of importing the task function and calling
  `.delay()`/`.apply_async()`. This is *why* the registration bug in §11.1 is invisible at
  import time — a typo or missing `include` entry produces no import error, only a silent
  runtime failure on the worker. Prefer importing the task object directly so `mypy`/import-time
  checks catch drift.
- **Modularity/extensibility:** the transformation grammar's kind→schema→sql-fn triad
  (`_KIND_SCHEMAS` / `_SQL_FNS` in transformation_grammar.py) is a clean extension point — adding
  a 12th kind is a well-contained change. Good design.
- **Duplication across modules:** the "edge → dict" shape is independently reconstructed in three
  places: `mapping_service._edge_to_dict` (mapping_service.py:603-621),
  `mapping_validation_service._edge_to_dict` (mapping_validation_service.py:196-211), and the
  router's `_edge_response` (mappings.py:26-46). These have already drifted once — the
  validation-service version omits `ai_confidence` and `audit` that the other two carry. This is
  a maintainability risk: a future field addition is a 3-site edit, and nothing forces them to
  stay in sync.
- **Scalability:** see §5/§8 — pagination and per-request O(n²)/O(columns×tables) issues are the
  main scalability gaps, not the overall architecture.

---

## 3. Code Quality Review

- **Readability:** good. Method names are intention-revealing, docstrings on modules explain
  intent, comments are used sparingly and mostly to explain *why* (e.g. the string-FK comment in
  `models/mapping.py:41-42`).
- **Naming:** consistent (`_assert_draft`, `_edge_to_dict`, `origin` enum values). One nit:
  `MappingService._add_edge_internal` vs `MappingService.add_edge` — the "internal" one skips a
  safety guard the "public" one enforces (see §11.4); the name doesn't communicate *which*
  invariant is being skipped, which is exactly how the FR3 bypass went unnoticed.
- **Dead code:** the `"lossy_warning"` verdict string is written into `MappingValidationService.
  validate_mapping`'s counting branch (mapping_validation_service.py:177) but never produced by
  `validate_edge` — effectively dead code that also masks a missing feature. Also
  `TransformationExpression`/graph-based mapping entities mentioned in TRD §11 as "core entities"
  don't exist as separate models; that's fine (the FieldMapping.transformation JSON column
  covers it) but worth flagging so nobody goes looking for a `TransformationExpression` table.
- **Redundancy:** the `flush()` → `record_audit()` → `commit()` pattern is repeated ~15 times
  across `mapping_service.py` with `record_audit` silently performing its own commit each time
  (see §11.6) — this is both redundant and actively dangerous.

---

## 4. Design Patterns & Best Practices

- **Allow-list/interpreter pattern** for the transformation grammar is the right call for a
  "restricted DSL, no arbitrary code execution" requirement (TRD §11) — well executed for 9 of
  11 kinds.
- **Anti-pattern — side-effecting helper masquerading as a logger:** `record_audit` (audit_helper.py)
  is documented as "Never raises" but achieves that by committing and rolling back the *caller's*
  shared session — i.e. it silently mutates transaction state that does not belong to it. A
  logging/audit helper should never call `commit()`/`rollback()` on a session it did not open;
  it should let the caller control the transaction boundary. See §11.6 for the concrete failure
  mode and fix.
- **SOLID:** `MappingService` has a wide surface (12 static methods covering create/CRUD/publish/
  suggestions/export) — borderline SRP violation, but static-method-namespace services are an
  established pattern in this codebase (see `MappingValidationService`, `SchemaService`), so
  it's consistent rather than a local defect.
- **DRY:** violated by the 3x edge-serialization duplication (§2) and by the near-identical
  `_sql_direct`/`_sql_upper`/`_sql_lower`/`_sql_trim` functions in transformation_grammar.py
  (149-215), which are all `if not sources: raise ...; return "FN(%s)"` with only the function
  name changing — could collapse to one parametrized helper.
- **YAGNI:** respected — no speculative abstraction, no premature plugin system for transformation
  kinds beyond the necessary dispatch table.

---

## 5. Performance Analysis

- **Critical: AI-suggestion cost blow-up.** `suggest_mappings_task` (mapping_tasks.py:56-106)
  calls `AIService.match_schemas(... target_schema=tgt_cols ...)` — which matches against
  **every column of the whole target table in one call** — but does so **inside the per-column
  loop** (`for tgt_col in tgt_cols: ... for src_table in source_schema: match_schemas(...)`).
  This makes the same whole-table LLM call once per column instead of once per table:
  cost = `Σ(columns in each unmapped target table) × (number of source tables)` instead of
  `(number of target tables) × (number of source tables)`. At the TRD's own stated scale (50
  tables / 1,000 columns, NFR §5) this is potentially thousands of redundant synchronous HTTP
  calls to Ollama (each with its own retry/backoff loop, `OLLAMA_MAX_RETRIES` retries with
  exponential backoff — ai_service.py:47-80), turning a task that should take seconds into one
  that could take hours or time out the worker entirely. Directly violates "AI suggestion
  response shall return within 3 seconds (p95) for a single target table" (TRD NFR §5).
- **`add_edge` many-to-many guard is O(existing_edges × sources_per_edge)** with a full Python
  scan of a JSON column (mapping_service.py:125-143) run on every single edge add. Fine at small
  scale, quadratic at the TRD's target scale of 1,000 columns being interactively edited.
- **Unbounded relationship load:** `Mapping.edges` has no query-level filter — every `GET
  /mappings/{id}` and every `GET /mappings/` loads *all* historical edges (every past published
  version's pinned copies plus the current draft) into memory, then filters
  `version_id is None` in Python (`mappings.py:60-62`). Over many publish cycles this grows
  without bound.
- **No pagination anywhere in the list endpoints** — see §8.

---

## 6. Security Review

- **Critical — latent SQL injection surface in the transformation compiler.**
  `transformation_grammar._sql_cast` (line 149-153) does:
  ```python
  return f"CAST(%s AS {payload['to']})"
  ```
  and `_sql_lookup` (line 233-244) does:
  ```python
  tbl = payload["table"]; kc = payload["key_column"]; vc = payload["value_column"]
  return f"(SELECT {vc} FROM {tbl} WHERE {kc} = %s{default_clause})"
  ```
  `to`, `table`, `key_column`, and `value_column` are validated only as **non-empty strings**
  (`_KIND_SCHEMAS` in the same file, lines 42/51-52) — there is no identifier allow-list, no
  regex restricting them to `[A-Za-z0-9_.]+`, no quoting. Any caller with `analyst`/`admin` role
  can set `"to": "TEXT); DROP TABLE users; --"` or `"table": "users; DELETE FROM users; --"` and
  it will be persisted as-is and handed back verbatim by `compile_sql`. **This is not yet
  exploitable inside this repo** because nothing currently calls `compile_sql` against a live
  connection (grep confirms the only callers are `transformation_grammar` tests) — but it is the
  exact hook the Pipelines team is told to use (`docs/mapper-mapping-contract.md` §4, which
  explicitly and incorrectly claims "No string interpolation of user data into SQL"). Fix before
  Pipelines integration, not after.
- **No tenant/ownership isolation.** `Mapping`, `DBConnection`, and `User` have no tenant/org
  column anywhere in the schema (confirmed via repo-wide grep for "tenant" — zero hits outside
  this TRD). `list_mappings`/`get_mapping` (mappings.py:78-98) gate only on "is authenticated,"
  not "owns or was granted this mapping" — any authenticated viewer/analyst/admin can read any
  other user's mapping definitions (including schema/column names of connections they may not
  otherwise have access to) purely by iterating mapping IDs. This is a pre-existing whole-app gap
  (not introduced by this feature), but the TRD explicitly assumes "mapping definitions are
  tenant-scoped and isolated" (TRD §9) and that assumption is false today. Flag to
  Security/Compliance sign-off (TRD Definition of Done item) before claiming FR12 is satisfied —
  role gating is not the same as tenant isolation.
- **IDOR-shaped gap:** `MappingCreate.source_id`/`target_id` (schemas/mapping.py:13-16) accept
  any integer ≥ 1 with no check that the caller is entitled to that `DBConnection` — combined
  with the point above, an analyst can create a mapping (and thus read/export schema metadata)
  against any connection ID that exists, not just ones assigned to them.
- **AI prompt construction** (`ai_service.py:32-45`) builds a natural-language prompt via
  f-string with raw table/column names — satisfies the "metadata only, no row values" NFR, but
  has no escaping/allow-listing of the names themselves, so a maliciously-named column
  (`'; ignore all prior instructions and ...`) could attempt prompt injection against the local
  Ollama call. Low blast radius today (only affects suggestion quality, not data access, and
  requires write access to a connected source schema already), but worth a defensive fix given
  the "regulated environment" bar.
- **Secrets/transport:** no TLS termination or secrets-handling code lives in this module (out of
  scope, handled at infra layer) — nothing to flag here beyond confirming this module doesn't
  itself leak secrets (it doesn't; `DBConnection.config` is never returned in mapping payloads).
- **Input validation:** solid at the Pydantic layer (`min_length`, `ge=1`, enum validators on
  `origin`) and at the grammar layer (`parse()` rejects unknown kinds/fields). Good.

---

## 7. Reliability & Resilience

- **Critical — audit helper breaks transactional atomicity of its caller.**
  `record_audit` (audit_helper.py:19-37) does:
  ```python
  entry = AuditLog(...)
  db.add(entry)
  db.commit()          # <-- commits the CALLER's whole pending transaction, not just this insert
  except Exception:
      db.rollback()     # <-- rolls back the CALLER's whole pending transaction too
  ```
  Every service method follows the pattern `db.add(x); db.flush(); record_audit(db, ...); db.commit()`
  (e.g. `create_mapping`, mapping_service.py:39-55). Because `record_audit` shares the caller's
  session, its internal `commit()` is what actually persists `x` — the flush merely staged it.
  If the audit insert itself fails for any reason (bad payload serialization, DB constraint,
  transient connection blip), `record_audit`'s `except` branch calls `db.rollback()`, which
  **discards the already-flushed business object** (`x`) that was never independently committed.
  Execution then returns to the caller, which proceeds to call `db.commit()` again (now a no-op
  on an empty transaction) and `db.refresh(x)` — at best raising an
  `InvalidRequestError`/`ObjectDeletedError` from SQLAlchemy, at worst (depending on session
  config) returning a detached, stale-but-still-populated Python object to the router, which then
  serializes and returns **HTTP 201 with a mapping that does not exist in the database**. This
  also breaks intra-operation atomicity even on the success path: `accept_suggestion`
  (mapping_service.py:286-343) calls `_add_edge_internal`, whose `record_audit` call
  (line 580-587) commits the new `FieldMapping` row **before** `accept_suggestion` goes on to set
  `edge.ai_confidence`, `sug.status = "accepted"`, etc. A crash between those two commits leaves a
  `FieldMapping` row persisted with `ai_confidence=None` and an `AISuggestion` still `pending` —
  an inconsistent, recoverable-only-by-hand state.
  **Fix:** `record_audit` should never call `commit()`/`rollback()` itself. It should `db.add(entry)`
  and let the caller's own `commit()` persist everything atomically; if audit-write durability
  independent of the business transaction is truly required, use a separate session/outbox
  pattern, not a shared-session commit hidden inside a "logging" helper.
- **Error handling in `publish`** (mapping_service.py:417-425) catches bare `Exception` from the
  schema-snapshot fetch and re-raises as HTTP 500 with the raw exception message interpolated
  into the response detail (`f"schema snapshot failed: {exc}"`) — this can leak internal
  exception text (e.g. driver connection strings, stack fragments) to API clients. Should log the
  full exception server-side and return a generic client-facing message.
- **Celery task error handling** (`mapping_tasks.py:125-133`) correctly wraps everything in
  try/except/finally with rollback+close — good defensive pattern, undermined only by the
  wiring bug in §11.1 that means the task body never runs in production at all.
- **No retry/backoff on `send_task`** itself — if the broker is briefly unavailable when a user
  clicks "Get AI Suggestions," the request fails with no automatic retry (acceptable for a
  user-initiated action, but worth confirming the frontend surfaces this clearly — it does, via
  the `catch` in `useMapping.requestSuggestions`, mapping.ts:343-347).

---

## 8. Concurrency & Scalability

- **No optimistic/pessimistic locking on `Mapping.status` transitions.** Two concurrent
  `publish` calls on the same draft mapping (e.g. double-click, or two admins) can both pass the
  `_assert_draft` check before either commits, then both proceed to compute `next_n` from the
  same `last.version_number`, race on `MappingVersion` insert, and rely purely on the
  `UniqueConstraint("mapping_id", "version_number")` (models/mapping.py:69-71) to fail one of
  them at the DB level with an unhandled `IntegrityError` (not caught anywhere in `publish`,
  mapping_service.py:395-467) — this will surface as an unhandled 500 instead of a clean 409.
  Add a `SELECT ... FOR UPDATE` (or a version-check compare-and-swap) around the read-then-write
  of `version_number`, and catch `IntegrityError` to translate into a clean "already published,
  retry" response.
- **No pagination on `GET /mappings/` or `GET /mappings/{id}/suggestions`** (mappings.py:78-89,
  176-186) — directly conflicts with NFR "mapping storage supports ≥10,000 versioned mapping
  definitions per tenant" (TRD §5). At 10,000 mappings this endpoint returns an unbounded
  response body on every page load of the mapping list UI.
- **Horizontal scaling of the suggestion service:** the Celery task pattern is right for
  horizontal scaling *in principle*, but is currently broken (§11.1) and, even once fixed, the
  O(columns × tables) cost (§5) means adding more workers just parallelizes an algorithmically
  wasteful workload rather than fixin
   it.

---

## 9. Cloud & DevOps Readiness

- **Containerization:** no issues found specific to this module; it runs inside the existing
  FastAPI/Celery containers defined in `docker-compose.yml`.
- **Critical — worker/task registration drift is invisible until runtime.** `celery_app.py`
  declares `include=["app.tasks.ai_tasks"]` only. `app/workers/mapping_tasks.py` (the module
  containing `suggest_mappings_task`) is never imported by that include list, by
  `app/tasks/ai_tasks.py` (checked — no reference), or by the worker's entrypoint
  (`docker-compose.yml:107`: `celery -A app.core.celery_app worker ...`). There is no CI/CD check
  that would have caught this — it is a purely runtime failure mode (`send_task` succeeds,
  execution silently never happens). See §11.1 for the full failure chain and the fix.
- **Observability:** `main.py` has request logging middleware and CORS but no metrics
  (Prometheus/OpenTelemetry) and no tracing wired into this module specifically — there is
  no way to alert on "suggestion tasks stuck in PENDING forever," which is exactly the failure
  mode §11.1 produces. Recommend: emit a Celery task-failure/unregistered-task alert, and add a
  metric for suggestion-task latency/failure rate before this ships.
- **Config:** `OLLAMA_MAX_RETRIES`/`OLLAMA_TIMEOUT` are externalized via settings — good. No
  circuit breaker around the Celery broker itself, only around Ollama (`ollama_circuit`,
  ai_service.py:61) — acceptable given broker outages are already a Celery-level concern.

---

## 10. Testability Review

- **Strong suite overall:** unit tests for the service state machine (`test_mapping_service.py`,
  17 tests), a dedicated type-matrix suite (`test_mapping_validation_service.py`, 14 tests), a
  grammar suite (`test_transformation_grammar.py`), a router role-gating suite, a full E2E smoke
  test that walks create→edge→suggest→accept/reject→validate→publish→export→audit
  (`test_e2e_smoke.py`), and a contract-lock test tying the export shape to the published doc
  (`test_export_contract.py`). This is materially better test discipline than most feature
  branches at this stage.
- **Critical coverage gap — the exact bug in §11.1 is untestable by design in the current
  harness.** `conftest.py:17` sets `CELERY_TASK_ALWAYS_EAGER=True`, which makes
  `celery_app.send_task(...)` execute the task function **synchronously in-process**, completely
  bypassing the broker/worker registration mechanism where the real bug lives. No test in this
  suite starts an actual `celery -A app.core.celery_app worker` process and asserts the task
  executes — that is the one integration point that would have caught this. Recommend adding a
  CI smoke check (even a simple one: `celery_app.tasks` should contain
  `"app.workers.mapping_tasks.suggest_mappings_task"` after importing `app.core.celery_app` the
  same way the worker entrypoint does) that fails fast on registration drift.
- **The `lossy_warning` gap in §11.2 is actually *documented* by a misleadingly-named test:**
  `test_int_to_text_is_lossy_warning_without_cast` (test_mapping_validation_service.py:55-62)
  asserts `verdict == "blocking"` with the comment "lossy without cast becomes blocking" — the
  test name and the TRD's FR7 both say this should be a warning, not a block. This test currently
  locks in the wrong behavior; it should be split into two cases (warning vs. blocking) once
  §11.2 is fixed.
- **No test exercises the SQL-injection surface in §6** because nothing in this repo currently
  calls `compile_sql` end-to-end against a real connection — add a test once that integration
  exists, and add unit tests today asserting `compile_sql`/`parse` reject non-identifier-shaped
  `to`/`table`/`key_column`/`value_column` values.
- **No test covers the FR3-via-suggestion-acceptance bypass in §11.4** — add a test that creates
  two `AISuggestion` rows targeting different target columns but the same source column, accepts
  both, and asserts the second is rejected (currently it would succeed).
- **Mocking:** `SchemaService.get_full_schema` is consistently monkeypatched across the suite —
  good, keeps tests from touching real DB connectors.

---

## 11. Refactoring Recommendations (priority-ordered — work top to bottom)

### #1 — CRITICAL — AI-suggestion task never runs in the deployed worker
**Problem:** `celery_app.py` only lists `include=["app.tasks.ai_tasks"]`; `app/workers/
mapping_tasks.py` is imported nowhere in the worker's module graph. `MappingService.
request_suggestions` (mapping_service.py:270-284) enqueues by string name
(`"app.workers.mapping_tasks.suggest_mappings_task"`); the real worker
(`celery -A app.core.celery_app worker`, docker-compose.yml:107) will log "Received unregistered
task" and never execute it. Every "Get AI Suggestions" click in production silently does nothing.
**Impact:** FR4, FR5, AC2 are non-functional in the deployed system. This is the feature's core
AI-assist value proposition per the TRD's business objective.
**Suggested solution:**
```python
# app/core/celery_app.py
celery_app = Celery(
    "dataplane",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.ai_tasks", "app.workers.mapping_tasks"],  # add this module
)
```
Also change `mapping_service.py` to import the task object directly instead of using a string
name, so a future rename/typo fails at import time instead of at runtime:
```python
from app.workers.mapping_tasks import suggest_mappings_task
...
task = suggest_mappings_task.delay(mapping_id=mapping_id)
```
Then add the CI/test safety net described in §10 (assert the task name appears in
`celery_app.tasks` after importing `app.core.celery_app`).

### #2 — CRITICAL — "lossy_warning" verdict tier is never produced (FR7/AC3 unmet)
**Problem:** `MappingValidationService.validate_edge` (mapping_validation_service.py:93-153) only
ever sets `verdict` to `"ok"` or `"blocking"`. The lossy-without-cast branches
(lines 129-133, and implicitly the incompatible-without-cast branch) both hard-block instead of
warning. FR7 requires "warning (lossy cast) OR blocking error (incompatible types)" as two
distinct outcomes; the code collapses them into one.
**Impact:** Publish gating (`blocking_count > 0` in `MappingService.publish`) is stricter than
spec'd — legitimate lossy-but-intentional mappings (e.g. INTEGER→TEXT with no cast, which is a
common, safe operation) are unpublishable without a redundant explicit cast, contradicting FR7's
intent that lossy conversions should be a *warning* the user can consciously accept, not a hard
stop.
**Suggested solution:**
```python
for src in sources:
    src_type = src.get("type") or ""
    if _is_incompatible(src_type, tgt_type):
        if not has_cast:
            verdict = "blocking"
            message = f"incompatible: cannot map {src_type} to {tgt_type} without cast"
            break
    elif _is_lossy(src_type, tgt_type):
        if not has_cast and verdict != "blocking":
            verdict = "lossy_warning"          # <-- was "blocking"
            message = (
                f"lossy: mapping {src_type} to {tgt_type} may lose precision; "
                f"add a CAST to acknowledge, or leave as a warning"
            )
    elif _is_lossless_widening(src_type, tgt_type):
        pass
```
Update `MappingService.publish` to keep `blocking_count > 0` as the publish gate (unchanged) but
confirm the UI surfaces `warning_count` distinctly (it already does — `useMapping.validate`,
useMapping.ts:410-419 — so this is purely a backend fix). Then fix
`test_int_to_text_is_lossy_warning_without_cast` to assert `"lossy_warning"`, and add a
companion test for the still-blocking `_is_incompatible` case.

### #3 — CRITICAL — Unvalidated identifiers interpolated into SQL fragments
**Problem:** `_sql_cast` (transformation_grammar.py:149-153) and `_sql_lookup` (233-244)
interpolate `payload["to"]`, `payload["table"]`, `payload["key_column"]`, `payload["value_column"]`
directly into an SQL string via f-strings. The grammar's own field-type checker
(`_check_field`, lines 83-133) only enforces "is a non-empty string" for these fields — no
identifier-shape or allow-list check.
**Impact:** Contradicts the published contract's explicit security claim ("No string
interpolation of user data into SQL," `docs/mapper-mapping-contract.md` line 148) and NFR
"transformation expressions sanitized/validated to prevent injection" (TRD §5). Will become a
live SQL injection vector the moment Pipelines wires `compile_sql` output into execution.
**Suggested solution:** add an identifier validator and apply it at `parse()` time so bad input
is rejected with the same `GrammarError` mechanism already in place, not caught downstream:
```python
import re
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

def _check_identifier(value: Any, location: str) -> str:
    if not isinstance(value, str) or not _IDENT_RE.fullmatch(value):
        raise GrammarError(
            f"expected a valid SQL identifier at {location} (got {value!r})",
            kind="bad_type", location=location,
        )
    return value
```
Add an `"identifier"` field-type tag to `_KIND_SCHEMAS` for `cast.to`, `lookup.table`,
`lookup.key_column`, `lookup.value_column` (and restrict `cast.to` further to a fixed allow-list
of known SQL type names, e.g. reuse the `_TEXT_FAMILY | _INT_FAMILY | ...` sets from
`mapping_validation_service.py` — don't let it be an arbitrary identifier at all, since it's a
type name, not a table/column reference). Wire the new tag into `_check_field`'s dispatch. Also
consider dialect-qualified quoting (e.g. double-quote identifiers) at `compile_sql` time as
defense in depth, even after the allow-list is in place.

### #4 — CRITICAL — `accept_suggestion` can create many-to-many mappings (FR3 violation)
**Problem:** `MappingService.accept_suggestion` (mapping_service.py:286-321) calls
`_add_edge_internal` specifically because it "Skip[s] the N:N guard since suggestion sources are
unique to this target" (comment, line 307). That invariant is not actually enforced anywhere:
`suggest_mappings_task` (mapping_tasks.py:56-91) computes the single best source match
**independently per target column** — nothing prevents two different target columns from both
getting the same best-matching source column suggested. Accepting both creates a genuine
many-to-many mapping through a path that has no guard at all.
**Impact:** Directly violates FR3 ("prevent unsupported many-to-many mappings") via the
AI-suggestion path, which is arguably the *more likely* path to trigger it than manual mapping
(since users will accept several high-confidence suggestions in a row without cross-checking
each other).
**Suggested solution:** run the same many-to-many check `add_edge` already has
(mapping_service.py:124-143) inside `_add_edge_internal` too — extract it into a shared private
helper and call it from both `add_edge` and `accept_suggestion`:
```python
@staticmethod
def _check_no_many_to_many(db, mapping_id, target, sources) -> None:
    target_key = (target["table"], target["column"])
    existing = (
        db.query(FieldMapping)
        .filter(FieldMapping.mapping_id == mapping_id, FieldMapping.version_id.is_(None))
        .all()
    )
    for src in sources:
        src_key = (src["table"], src["column"])
        for e in existing:
            e_target_key = (e.target_table, e.target_column)
            for es in (e.sources or []):
                if (es.get("table"), es.get("column")) == src_key and e_target_key != target_key:
                    raise HTTPException(409, detail=(
                        f"source {src_key} already mapped to {e_target_key}; "
                        "many-to-many is not supported"
                    ))
```
Call it from both `add_edge` and `_add_edge_internal` (i.e. from `accept_suggestion` too), and
delete the misleading comment that justified skipping it.

### #5 — CRITICAL — O(columns × source tables) LLM calls in suggestion generation
**Problem:** see §5. `suggest_mappings_task` calls `AIService.match_schemas(target_schema=tgt_cols, ...)`
— a whole-target-table match — once per column of that table, redundantly.
**Impact:** Breaks the 3s p95 NFR by orders of magnitude at the TRD's own stated scale; makes the
feature effectively unusable (and expensive, since each call also retries against Ollama on
failure) on any schema larger than a handful of tables/columns.
**Suggested solution:** hoist the `match_schemas` call outside the column loop — call it once per
`(source_table, target_table)` pair, then distribute the resulting matches to each unmapped
column:
```python
suggestions_created = 0
for tgt_table, tgt_cols in target_schema.items():
    unmapped_cols = {
        c["name"]: c for c in tgt_cols
        if (tgt_table, c["name"]) not in existing_targets
    }
    if not unmapped_cols:
        continue
    best_by_col: dict[str, dict] = {}
    for src_table, src_cols in source_schema.items():
        try:
            result = AIService.match_schemas(
                source_name=src_table, source_schema=src_cols,
                target_name=tgt_table, target_schema=list(unmapped_cols.values()),
            )
        except Exception as exc:
            logger.warning("AIService.match_schemas failed for %s -> %s: %s", src_table, tgt_table, exc)
            continue
        for match in result.get("matches", []) or []:
            tgt_name = match.get("target")
            if tgt_name not in unmapped_cols:
                continue
            conf = float(match.get("confidence", 0) or 0)
            if tgt_name not in best_by_col or conf > best_by_col[tgt_name]["confidence"]:
                best_by_col[tgt_name] = {
                    "source_table": src_table,
                    "source_column": match["source"],
                    "source_type": next((c.get("type") for c in src_cols if c.get("name") == match["source"]), None),
                    "confidence": conf,
                    "reason": match.get("reason"),
                }
    for tgt_col_name, best in best_by_col.items():
        if best["confidence"] >= 50:
            db.add(AISuggestion(mapping_id=m.id, target_table=tgt_table,
                                 target_column=tgt_col_name,
                                 target_type=unmapped_cols[tgt_col_name].get("type"),
                                 source_table=best["source_table"], source_column=best["source_column"],
                                 source_type=best["source_type"], confidence=best["confidence"],
                                 reason=best["reason"], status="pending"))
            suggestions_created += 1
```
This drops the call count from `Σ(columns) × Σ(source_tables)` to `Σ(target_tables) ×
Σ(source_tables)` — matches the NFR's "per single target table" framing.

### #6 — CRITICAL — `record_audit` commits/rolls back the caller's shared session
**Problem:** see §7 for the full failure chain. `audit_helper.record_audit` (audit_helper.py:19-37)
calls `db.commit()` and, on failure, `db.rollback()` on the session passed in by the caller —
breaking the atomicity of whatever business operation was in progress on that same session.
**Impact:** silent data loss on audit-write failure (rare, but "audit log fails to write while I
guarantee full audit coverage" is precisely the failure mode a regulated-environment reviewer
will ask about), plus non-atomic multi-step operations like `accept_suggestion` that partially
commit today regardless of audit failure.
**Suggested solution:** remove the commit/rollback from `record_audit`; let callers own their
transaction boundary (they already all call `db.commit()` right after):
```python
def record_audit(db, event_type, actor="admin", connection_id=None, connection_name=None,
                  payload=None, status="success", duration_ms=None) -> None:
    try:
        entry = AuditLog(event_type=event_type, actor=actor, connection_id=connection_id,
                          connection_name=connection_name, payload=payload or {},
                          status=status, duration_ms=duration_ms)
        db.add(entry)
        db.flush()          # surface constraint errors now, without committing
    except Exception as exc:
        logger.warning("Failed to write audit log (%s): %s", event_type, exc)
        # do NOT rollback here — that would discard the caller's pending work too.
        # Re-raise only if audit durability is a hard requirement for this call site;
        # otherwise let the caller's own commit proceed without the audit row.
```
Then remove every now-redundant standalone `db.commit()` that exists *only* to work around
`record_audit` having already committed — audit each of the ~15 call sites in
`mapping_service.py` and consolidate to exactly one `commit()` per method, after
`record_audit()`.

### #7 — HIGH — Frontend fabricates fake connector data on API failure
**Problem:** `CreateMappingModal`'s connector fetch (MappingList.tsx:153-174) falls back to a
hardcoded list of fictional connections (`CRM_Source_Analytics`, `Finance_Oracle`, etc. with IDs
1-5) if `/api/v1/connectors/` fails, with **no error shown to the user**.
**Impact:** A user can unknowingly create a mapping draft against connection IDs that are
fabricated display data, not the real system state — in a tool whose entire value proposition is
audit/governance trustworthiness, this is a serious correctness and trust defect.
**Suggested solution:** surface the failure instead of masking it:
```tsx
.catch((err) => {
  setLoadError(err instanceof ApiError ? err.message : "Failed to load connections.");
  setConnectors([]);
});
```
and disable submission / show a retry affordance when `connectors.length === 0`. Never substitute
fabricated production-shaped data for a failed API call.

### #8 — HIGH — No pagination on list endpoints
**Problem:** `GET /api/v1/mappings/` and `GET /api/v1/mappings/{id}/suggestions`
(mappings.py:78-89, 176-186) return unbounded result sets.
**Impact:** contradicts NFR "≥10,000 versioned mapping definitions per tenant" — this endpoint
becomes the first thing to fall over at that scale, and it's the one the mapping-list sidebar
calls on every page load.
**Suggested solution:** add standard `limit`/`offset` (or cursor) query params with a sane
default (e.g. `limit: int = Query(50, le=200)`), and return a total count or `has_more` flag for
the frontend's `MappingList` to page through.

### #9 — HIGH — No tenant/ownership isolation on mapping read access
**Problem:** see §6. `list_mappings`/`get_mapping` check only authentication, not ownership or
tenant scope; no tenant column exists anywhere in the schema.
**Impact:** blocks the TRD's Definition of Done item "Security/compliance sign-off for
regulated-environment constraints" — this is exactly the class of gap that sign-off exists to
catch.
**Suggested solution:** this is a whole-app architectural gap beyond this module's scope to fully
fix, but at minimum: (a) flag it explicitly to Security/Compliance rather than letting FR12 be
marked "done" on role-gating alone, and (b) if a `tenant_id`/`org_id` concept is introduced
elsewhere in the app before this ships, thread it through `Mapping`/`DBConnection` and add a
`WHERE tenant_id = :current_tenant` filter to every query in `mapping_service.py` and
`mappings.py`.

### #10 — MEDIUM — No narrowing checks within a type family
**Problem:** `_is_lossy`/`_is_incompatible` (mapping_validation_service.py:57-89) operate on
coarse families; `BIGINT → SMALLINT`, `DOUBLE → REAL`, `DECIMAL(18,4) → INTEGER` are all
"same family" and fall through to the unconditional "ok" branch (`validate_edge`, line 136-140).
**Impact:** silent-truncation/overflow risk at pipeline-execution time is invisible to the
Schema Mapper's own validation, contradicting FR7's intent to catch exactly this class of issue.
**Suggested solution:** once #2 lands, extend `_is_lossy` with within-family narrowing checks
using an explicit rank table, e.g.:
```python
_INT_RANK = {"TINYINT": 1, "SMALLINT": 2, "INTEGER": 3, "INT": 3, "BIGINT": 4}
_FLOAT_RANK = {"REAL": 1, "FLOAT": 2, "DOUBLE": 3, "DECIMAL": 3, "NUMERIC": 3}

def _is_lossy(src, tgt):
    ...
    s_n, t_n = _normalize(src), _normalize(tgt)
    if s_n in _INT_RANK and t_n in _INT_RANK and _INT_RANK[s_n] > _INT_RANK[t_n]:
        return True
    if s_n in _FLOAT_RANK and t_n in _FLOAT_RANK and _FLOAT_RANK[s_n] > _FLOAT_RANK[t_n]:
        return True
    ...
```

---

## 12. Risk Assessment

| Risk | Category | Likelihood | Impact | Notes |
|---|---|---|---|---|
| AI suggestions silently never generate in prod | Production/Functional | **Certain** (deterministic wiring bug) | High — core feature dead | §11.1 |
| Lossy conversions wrongly hard-blocked | Production/Functional | High | Medium — user friction, workaround exists (add a no-op cast) | §11.2 |
| SQL injection via `cast.to`/`lookup.*` once Pipelines wires execution | Security | Medium (depends on downstream adoption timing) | Critical if triggered | §11.3 |
| Many-to-many mapping created via AI-suggestion accept | Functional/Data integrity | Medium | Medium — downstream pipeline consumers may not expect N:N | §11.4 |
| AI-suggestion feature unusably slow/costly at real schema scale | Performance | High (any schema >5-10 tables) | Medium-High — feature perceived as broken, Ollama cost/load spike | §11.5 |
| Silent partial commits / audit-write failures dropping business data | Reliability/Data integrity | Low likelihood, high blast radius when it fires | High | §11.6 |
| Fabricated connector fallback data misleads users | Operational/Trust | Medium (only on API failure) | High in a compliance-sensitive tool | §11.7 |
| Unbounded list endpoints degrade at scale | Scalability | High as tenants grow | Medium | §11.8 |
| No tenant isolation | Security/Compliance | Certain (structural) | High for a "regulated environment" product | §11.9 |
| Publish race condition raises unhandled 500 | Reliability | Low (requires concurrent double-publish) | Low-Medium | §8 |

---

## 13. Final Verdict

**Approve with Required Changes.** Do not ship to production until at minimum items **#1–#6**
in §11 are fixed (all rated Critical) — each is independently verifiable with the evidence cited
above, not speculative. Items #7–#10 should be fixed before general availability but could ship
behind a known-issues note if there's schedule pressure on #1–#6 alone.

**Top 5 actions required before production release:**
1. Register `app.workers.mapping_tasks` with the Celery app (`include=[...]`) and add a
   startup/CI check that fails if `suggest_mappings_task` is not in `celery_app.tasks` — §11.1.
2. Implement the missing `lossy_warning` verdict path in `MappingValidationService.validate_edge`
   and fix the test that currently locks in the wrong behavior — §11.2.
3. Add identifier/type-name validation to `cast.to` and `lookup.table/key_column/value_column`
   in `transformation_grammar.py` before any downstream consumer executes `compile_sql` output —
   §11.3.
4. Close the many-to-many gap in `accept_suggestion` by sharing the same guard `add_edge` already
   enforces — §11.4.
5. Remove `db.commit()`/`db.rollback()` from `record_audit` so audit-log failures can never
   silently discard a caller's business transaction — §11.6.

Fix the O(columns × tables) suggestion-generation cost (§11.5) in the same pass as #1, since
both live in `mapping_tasks.py`/`mapping_service.py` and will be touched together.
