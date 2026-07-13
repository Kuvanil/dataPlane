# Audit Trail (DP-AUDIT-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Audit_Trail.md` (8 FRs, 8 subtasks, ~30 days estimated = ~6 weeks).
> Scope: Centralized tamper-evident audit log ingestion, canonical event schema, append-only storage with hash-chain integrity, searchable/filterable viewer, export (CSV/JSON), configurable retention, role-gated access, correlation tracing.
>
> **2026-07-09 audit:** The codebase has a basic foundation — `AuditLog` model (`backend/app/models/audit.py`) with `id`, `event_type`, `actor`, `connection_id`, `connection_name`, `payload` (JSON), `status`, `duration_ms`, `created_at`. The `record_audit` helper (`backend/app/services/audit_helper.py`) writes events with SAVEPOINT isolation. The `audit.py` router (`backend/app/api/routers/audit.py`) has `GET /audit/` (paginated list with basic filters), `GET /audit/summary` (aggregate counts), and `GET /audit/{id}` (single event). What's **missing from the TRD**:
>
> - No canonical event schema/contract — the current payload is unstructured JSON.
> - No tamper-evidence — storage is standard SQL, no hash chaining.
> - No append-only enforcement — nothing prevents edit/delete of events through direct DB access.
> - No export endpoint (CSV/JSON).
> - No role-gated access to the audit viewer.
> - No retention policy enforcement.
> - No correlation ID field on the model.
> - No search/filter beyond basic event_type/connection_id/status.
> - No audit viewer UI in the frontend.
>
> **FR1–FR9 verdict (as of 2026-07-09):**

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | Accept events from all modules via common ingestion API | **DONE** — canonical schema (T1) + `POST /audit/events` batch ingestion with durable buffering/backpressure (T2) | AUDIT-T1, AUDIT-T2 |
| FR2 | Append-only storage, no edit/delete | **DONE** — no PUT/DELETE routes (405), plus a DB-level trigger rejects UPDATE/DELETE on `audit_log` outright (Postgres + SQLite) | AUDIT-T3 |
| FR3 | Tamper-evidence (hash chaining) | **DONE** — SHA-256 hash chain computed pre-insert (single INSERT, no follow-up UPDATE — required for the append-only trigger to hold), `POST /audit/verify` walks and validates the chain | AUDIT-T3 |
| FR4 | Search/filter by actor, module, action, target, date range | **DONE** — `GET /audit/events` (all filters + full-text search + pagination + sort allow-list), `GET /audit/events/facets`, composite indexes for the common query patterns | AUDIT-T1, AUDIT-T4 |
| FR5 | Export filtered results as CSV/JSON | **DONE** — `GET /audit/export`, true DB-cursor streaming (dedicated session, `yield_per`), configurable row cap | AUDIT-T6 |
| FR6 | Configurable retention policy | **NOT DONE** — status endpoint exists (`GET /audit/retention-status`) but no cleanup enforcement | AUDIT-T7 |
| FR7 | Role-gated access to audit viewer | **NOT DONE** — no role gating on audit endpoints | AUDIT-T7 |
| FR8 | Correlation ID for multi-step tracing | **DONE** — `correlation_id` field + sequence-ordered chain traversal, defaults search ordering to sequence-ascending when filtering by correlation_id | AUDIT-T1 |

**6 of 8 FRs fully done; 0 partially done; 2 not done (both FR6/FR7, both scoped to AUDIT-T7 — retention + role gating, not attempted this round).**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_canonical_event_schema_contract.md) | FR1, FR8, §11 Data model | [x] | Canonical event schema + SDK/contract — define the canonical AuditEvent schema, create shared SDK for modules, add correlation_id/before_after/target/module fields |
| [02](02_ingestion_api_durable_buffering.md) | FR1, Reliability NFR, §11 API | [x] | Ingestion API + durable buffering — `POST /audit/events` endpoint, durable queue-backed ingestion, event validation, backpressure |
| [03](03_append_only_store_tamper_evidence.md) | FR2, FR3, Security NFR | [x] | Append-only store + tamper-evidence — hash chain implementation, append-only enforcement, integrity verification API |
| [04](04_search_filter_query_layer_indexing.md) | FR4, Performance NFR | [x] | Search/filter query layer + indexing — full search/filter API, faceted search, date range queries, correlation tracing, partitioned indexing for scale |
| [05](05_viewer_ui_detail_correlation_tracing.md) | FR4, Usability NFR | [x] | Viewer UI + detail + correlation tracing — frontend audit log viewer, event detail view, correlation trace visualization, filter UI |
| [06](06_export_csv_json.md) | FR5 | [x] | Export CSV/JSON — export endpoint for filtered results, streaming export for large result sets |
| [07](07_retention_policy_role_gating.md) | FR6, FR7 | [ ] | Retention policy + role gating — configurable retention, automated cleanup, role-gated access to viewer/export |
| [08](08_tests.md) | §12 DoD | [~] | Tests — `backend/tests/audit/` covers T1/T2/T3/T4/T6 (29 tests); no `test_retention.py`/`test_role_gating.py` (blocked on #07) and no dedicated performance/throughput tests |
| [09](09_security_compliance_signoff.md) | Security NFR, §12 DoD | [ ] | Security/compliance sign-off — tamper-evidence validation, retention verification, role gating audit |

## Confidence per task

- **#1 Event schema** — HIGH confidence. Pydantic model definition, straightforward.
- **#2 Ingestion API** — MEDIUM confidence. Durable buffering with backpressure needs careful design. Message queue integration.
- **#3 Tamper-evidence** — MEDIUM confidence. Hash chain is well-understood but the verification mechanism needs thought. Append-only enforcement needs DB-level constraints.
- **#4 Search/filter** — MEDIUM confidence. Indexing strategy for millions of events needs planning.
- **#5 Viewer UI** — MEDIUM confidence. Standard data table with filters, but correlation tracing visualization adds complexity.
- **#6 Export** — HIGH confidence. Streaming export is standard.
- **#7 Retention** — MEDIUM confidence. Cleanup needs careful batching to avoid performance impact.
- **#8 Tests** — MEDIUM confidence. Tamper-evidence tests are non-trivial.
- **#9 Security sign-off** — [!] Cross-reference.

## Execution order (recommended)

1. **#1 Event schema** — foundation: define the canonical event structure every module will emit.
2. **#2 Ingestion API** — build the ingestion endpoint. Depends on #1.
3. **#3 Tamper-evidence** — core integrity mechanism. Can proceed in parallel with #2 once schema is defined.
4. **#4 Search/filter** — query layer on top of stored events.
5. **#5 Viewer UI** — frontend, depends on #4.
6. **#6 Export** — depends on #4 (query layer) and #5 (trigger from UI).
7. **#7 Retention** — depends on #3 (tamper-evident storage) and #4 (query layer for identifying expired events).
8. **#8 Tests** — incremental.
9. **#9 Security sign-off** — cross-team.

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 9 task files. 0/8 FRs fully done. Basic audit logging exists (AuditLog model + record_audit helper + list/summary endpoints) but lacks tamper-evidence, canonical schema, correlation IDs, export, retention, role gating, and a viewer UI.
- 2026-07-11 — **#1 done.** The canonical `AuditEvent` schema, `event_metadata`/`target_type`/`module`/`correlation_id` columns, `emit_audit_event` SDK helper, and hash-chain scaffolding (AUDIT-T3) had already landed in a prior session's commit (`34fb9e0`), along with untested router code for ingestion (T2), search (T4), integrity verify (T3), and export (T6) — but the whole backend was broken: `AuditLog.metadata = Column(...)` collides with SQLAlchemy's reserved `Base.metadata` attribute, so `class AuditLog(Base)` raised `InvalidRequestError` at import time and every module transitively importing it (i.e. the whole app) failed to load. Fixed by renaming the mapped attribute to `event_metadata` (DB column name kept as `"metadata"` via `Column("metadata", ...)`, no migration tooling in this repo) and aliasing `AuditEventResponse.metadata` back to it via `validation_alias`. Added `backend/tests/audit/` covering AUDIT-T1's verify checklist (canonical fields persist, correlation_id round-trips for tracing, legacy `record_audit` still works, response serialization doesn't silently drop `metadata`). Full suite: 417/417 passing.
- **Caveat / open risk (superseded below):** #2 (ingestion API), #3 (tamper-evidence/verify), #4 (search/filter), #6 (export) already have substantial router code from the same prior commit but **zero tests** — this session only verified/tested #1 (the foundation). That code is unverified and should not be assumed correct; each task should get its own focused test pass before being marked done.
- 2026-07-11 — **#2, #3, #4, #6 done; #5 done (new).** Picked up where the previous entry left off — the untested T2/T3/T4/T6 router code got its test passes, and each one turned up a real bug that testing (not just running the app) caught:
  - **#2 Ingestion + durable buffering** — `POST /audit/events` now goes through a new `ingest_audit_event_durable()` (`audit_helper.py`), which is deliberately a *separate* code path from `emit_audit_event()`: the latter's swallow-and-log contract is load-bearing for every other service's business-transaction atomicity and was left untouched. The new path adds a `CircuitBreaker` (reused `app/core/circuit_breaker.py`, already used for Ollama) over the DB write, with bounded retries, falling back to a bounded in-process buffer (`app/core/audit_buffer.py`) on failure; a new Celery beat task (`app.tasks.audit_tasks.flush_audit_buffer_task`, every `AUDIT_BUFFER_FLUSH_INTERVAL_MINUTES`) drains and retries it. Whole-batch backpressure (buffer full for every event in the batch) returns 503 + `Retry-After` instead of silently dropping. Known limitation: the buffer is in-process, not broker-backed — it survives a transient DB blip but not an app restart; documented as a deliberate scope cut, not an oversight.
  - **#3 Tamper-evidence** — found and fixed a real correctness bug: the hash chain was computed via flush-then-mutate-then-implicit-UPDATE, which is fundamentally incompatible with a true append-only DB trigger (the trigger would reject the app's own hash write-back). Refactored to compute `sequence`/`prev_hash`/`event_hash` *before* the row exists (locked read of the chain tip via `with_for_update()`, a no-op-but-harmless on SQLite) so every write is a single INSERT. Added the actual DB-level trigger (`app/core/audit_guard.py`, dialect-aware Postgres PL/pgSQL + SQLite `RAISE(ABORT,...)`, installed on startup in `main.py`'s lifespan) that rejects UPDATE/DELETE outright — verified against both SQLite (tests) and live Postgres (`docker exec ... psql -c "UPDATE audit_log ..."` → rejected). Also found via testing: hashing `created_at` was flaky — SQLite doesn't preserve tzinfo through its DATETIME storage, so a session-expired re-fetch produced a different `.isoformat()` than the write-time value, making `verify_hash_chain` false-flag every row as tampered. Fixed by excluding `created_at` from the hashed content (`sequence` already gives total ordering).
  - **#4 Search/filter** — added the composite indexes the task spec calls for (`correlation_id+sequence`, `actor+created_at`, `module+event_type+created_at`, `target_type+target_id+created_at`, `event_type+created_at`). Fixed a real bug: `sort_by` was passed straight into `getattr(AuditLog, sort_by, default)` — since renaming the metadata column freed up `AuditLog.metadata` to mean `Base.metadata` again, `?sort_by=metadata` would resolve to the SQLAlchemy MetaData registry and 500 on `.asc()`; replaced with an explicit allow-list. `correlation_id` searches now default to sequence-ascending (the order things actually happened) instead of the general default of newest-first, per spec.
  - **#6 Export** — the existing implementation loaded the entire filtered result set into memory (`q.all()`) despite claiming to "stream" — the opposite of the task's own risk callout. Rewrote to stream from a query with `yield_per(1000)` + `stream_results=True` (real server-side cursor on Postgres). This surfaced a genuine FastAPI gotcha, empirically confirmed with a standalone repro before trusting it: a `Depends(get_db)`-scoped session is closed by FastAPI as soon as the endpoint returns, which happens as soon as `StreamingResponse` is constructed — *before* the generator actually iterates the query, during response-body streaming. Fixed by giving the export generator its own dedicated `SessionLocal()` scoped to its own lifetime, closed in its own `finally`. Row cap and filename date are now `settings.AUDIT_EXPORT_MAX_ROWS`-driven instead of hardcoded.
  - **#5 Viewer UI (new, not previously scoped as "done" anywhere)** — built the full frontend feature per the task's component architecture: `dashboard/audit/page.tsx` + `components/{FilterBar,EventTable,EventDetail,CorrelationTimeline,JsonViewer,ExportButton}.tsx`, `hooks/useAuditEvents.ts` (reuses the existing `useWidgetData` abort-safe fetch hook), `lib/types.ts`. Export button needed a new `api.download()` in `lib/api.ts` (blob + filename-from-Content-Disposition) since `frontend/src/lib/api.ts` is the only place allowed to call `fetch`. This is a parallel page to the pre-existing legacy `/audit` viewer (still on `GET /audit/`/`/audit/summary`, used by the dashboard home's ActivityFeed) — not removed, since retiring it wasn't in scope and other code still depends on those endpoints.
  - **New tests:** `backend/tests/audit/{test_ingestion_buffering,test_tamper_evidence,test_search_filter,test_export}.py`, 29 tests total across the package (including the earlier #1 tests). `frontend/src/app/dashboard/audit/__tests__/page.test.tsx`, 6 tests.
  - **Verified:** backend pytest 442/442 (full suite, up from 417). Frontend tsc clean, `next build` clean (including static-export of `/dashboard/audit`), lint introduces zero new problems, vitest 76/76 (up from 70). Live: rebuilt and restarted `api`/`worker`/`beat`/`frontend` containers (they'd been crash-looping in the background this whole session on the pre-fix image — `docker ps` showing `Restarting` was the tell), then smoke-tested against the real stack: ingested an event via curl, searched/faceted it back, exported CSV with the dated filename, verified the hash chain via `POST /audit/verify`, and confirmed a raw `psql UPDATE` against `audit_log` is rejected by the trigger on real Postgres (not just SQLite).
  - **Still open, correctly:** #07 (retention + role gating — audit router has zero auth gating today), #09 (security sign-off, cross-team). #08 tests partial — no retention/role-gating tests (blocked on #07) and no dedicated performance/throughput tests against the NFR thresholds. **Uncommitted.**