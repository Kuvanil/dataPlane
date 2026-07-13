# Query Studio (DP-QS-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Query_Studio.md` (9 FRs, 9 subtasks, ~25 days estimated = ~5 weeks).
> Scope: SQL editor with syntax highlighting and schema-aware autocomplete, connection/database selector, read/write statement classification with write gating, paginated query execution, per-user query history, saved queries, send-to-Visualize handoff, CSV export, audit emission.
>
> **2026-07-09 audit:** The codebase has a foundation — `backend/app/api/routers/query.py` with `POST /query/nl2sql` (NL-to-SQL via `NL2SQLService`), `GET /query/report/{connection_id}`, and `GET /query/history`. The `QueryHistory` model (`backend/app/models/query_history.py`) exists. However, this implementation overlaps significantly with AskData Bot's NL-to-SQL scope and doesn't match the Query Studio TRD:

> **FR1–FR9 verdict (as of 2026-07-09):**

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | SQL editor with syntax highlighting + schema-aware autocomplete | **DONE** — CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-sql`), dialect picked from connection type, schema completion sourced from the existing Schema Intel catalog (`GET /catalog/{id}/tables`) | QS-T4 |
| FR2 | Select execution context (connection/database) before running | **DONE** — `ConnectionSelector`, defaults to the first connection | QS-T1, QS-T4 |
| FR3 | Execute queries, return paginated results table | **DONE** — `POST /query-studio/execute`, in-memory pagination (see #1's caveat below — no server-side cursor at the connector layer) | QS-T1, QS-T5 |
| FR4 | Detect write/DDL, require role + explicit confirmation | **DONE** — `statement_classifier.classify()` wired in; INSERT/UPDATE/DELETE/DDL need `role=admin` **and** `confirm=true`, else `requires_confirmation=true` with nothing executed | QS-T2, QS-T3 |
| FR5 | Per-user query history | **DONE** — `GET /query-studio/history`, sourced from the audit log (`module=query_studio`, scoped to `actor=current_user`) rather than a new table | QS-T6 |
| FR6 | Save and name queries, reload them | **DONE** — `SavedQuery` model + `POST/GET/DELETE /query-studio/saved`, per-user scoped, admin can delete anyone's | QS-T6 |
| FR7 | Send result set to Visualize | **`[?]` OPEN — not attempted.** The TRD's "send query results to Visualize for charting" doesn't match what `/dashboard/visualize` actually is: a ReactFlow schema-relationship graph (tables/columns/PII risk), not a chart-rendering surface for arbitrary result sets. Same category of TRD-vs-implementation mismatch as AskData Bot's. Needs a product decision on what "send to Visualize" should actually do before this is buildable — see note below. | QS-T7 |
| FR8 | Export results as CSV | **DONE** — `POST /query-studio/export`, SELECT-only, bounded by `settings.QUERY_STUDIO_MAX_RESULT_ROWS` (same limitation as #3 — no true DB-cursor streaming through the connector layer) | QS-T5 |
| FR9 | Audit event for every executed statement | **DONE** — every execute/export call emits `query.select_executed` / `query.write_executed` / `query.blocked` / `query.error` via `emit_audit_event` | QS-T8 |

**8 of 9 FRs fully done; 0 partially done; 1 open (FR7, needs a product decision, not a build gap).**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_query_execution_service_pagination.md) | FR3, §11 API | [x] | Query execution service + pagination — direct SQL execution endpoint, paginated result streaming, timeout/cancellation, connection context |
| [02](02_statement_classifier_read_write_ddl.md) | FR4, Security NFR | [x] | Statement classifier (read/write/DDL) — classifier for input SQL, multi-statement detection, metadata extraction (tables, columns) |
| [03](03_write_statement_gating_confirmation.md) | FR4 | [x] | Write-statement gating + confirmation — role-based write permission check, explicit user confirmation flow, write-blocked error paths |
| [04](04_editor_syntax_highlighting_autocomplete.md) | FR1, FR2, Usability NFR | [x] | SQL editor UI — syntax highlighting, schema-aware autocomplete from Schema Intel, formatting, connection selector |
| [05](05_results_table_export_csv.md) | FR3, FR8 | [x] | Results table + CSV export — paginated results view, CSV download, large result handling (bounded, see caveat) |
| [06](06_history_saved_queries.md) | FR5, FR6 | [x] | History + saved queries — per-user query history viewer, save/load/named queries, reload into editor |
| [07](07_send_to_visualize_handoff.md) | FR7 | [?] | Send-to-Visualize handoff — blocked on a product decision: the TRD's intent doesn't match what `/dashboard/visualize` is today (schema graph, not a chart surface) |
| [08](08_audit_emission.md) | FR9 | [x] | Audit emission — emit audit events for every statement execution with full context |
| [09](09_tests.md) | §12 DoD | [~] | Tests — `backend/tests/query_studio/` (26 tests: execution/pagination/write-gating/multi-statement/role-gating, saved queries, per-user history, CSV export) + `frontend/.../query-studio/__tests__/` (5 tests); no dedicated perf/throughput tests |
| [10](10_security_signoff.md) | §12 DoD, Security NFR | [ ] | Security sign-off — write gating review, statement classifier validation, audit completeness |

## Confidence per task

- **#1 Execution service** — MEDIUM confidence. Builds on the connector framework. Pagination and timeout handling need careful design.
- **#2 Statement classifier** — HIGH confidence. Self-contained component using sqlparse.
- **#3 Write gating** — MEDIUM-HIGH confidence. Role/permission system integration needed.
- **#4 Editor UI** — MEDIUM confidence. Requires a SQL editor library (CodeMirror/Monaco). Schema-aware autocomplete requires Schema Intel API.
- **#5 Results table** — LOW-MEDIUM confidence. Pagination for large result sets is complex. CSV export is straightforward.
- **#6 History/saved queries** — MEDIUM confidence. History model exists; saved queries need new model and UI.
- **#7 Send-to-Visualize** — HIGH confidence. Simple handoff endpoint.
- **#8 Audit emission** — HIGH confidence. Established pattern.
- **#9 Tests** — MEDIUM confidence. Integration tests need real or well-mocked database connections.
- **#10 Security sign-off** — [!] Cross-reference, depends on Security review.

## Execution order (recommended)

1. **#2 Statement classifier** — foundation component needed by both execution (#1) and write gating (#3).
2. **#1 Execution service** — core execution engine. Depends on #2 for statement classification.
3. **#3 Write gating** — safety layer on top of #1 and #2.
4. **#4 Editor UI** — frontend. Can proceed in parallel with backend tasks once API contract is stable.
5. **#5 Results table** — frontend, depends on #1 for API contract.
6. **#6 History/saved queries** — depends on #1 (execution creates history) and #4 (editor context for reload).
7. **#7 Send-to-Visualize** — depends on Visualize module.
8. **#8 Audit emission** — incremental, integrated as each component lands.
9. **#9 Tests** — incremental.
10. **#10 Security sign-off** — cross-team.

## Architecture note

The current `query.py` router's NL-to-SQL endpoint (`POST /query/nl2sql`) overlaps with AskData Bot's scope. ~~Once both epics are implemented, the NL-to-SQL functionality should be removed from Query Studio~~ — **done 2026-07-11**: `frontend/src/app/dashboard/query-studio/page.tsx` no longer calls `/api/v1/query/nl2sql` at all; it's now the real manual-SQL-authoring workspace. The legacy `query.py` router/endpoint itself was left in place (re-tagged "Query (Legacy NL2SQL)" in `main.py`'s OpenAPI tags) since nothing else in Query Studio depends on it anymore, but AskData Bot hasn't been rebuilt yet and may still need it as a starting point.

## Known limitations (by design, not oversights)

- **No server-side cursor / true streaming pagination.** Every connector's `execute_query()` does a plain `fetchall()` — there's no chunked/cursor-based fetch at the connector-abstraction layer. Query Studio's pagination and CSV export are both bounded, in-memory, capped at `settings.QUERY_STUDIO_MAX_RESULT_ROWS` (default 5000). Fine for typical DBA workbench queries; a genuinely huge export would need connector-layer changes (out of scope here — flagged, not silently accepted).
- **Query timeout is best-effort.** `QUERY_STUDIO_EXECUTION_TIMEOUT_SECONDS` wraps execution in a thread pool with `.result(timeout=...)` — if it fires, the caller gets an error back, but the underlying DB-side statement isn't actively cancelled (no per-dialect `pg_cancel_backend`-style hookup). The connection just gets abandoned to GC/close.
- **Write execution is gated but real.** Admin role + explicit `confirm=true` is required for INSERT/UPDATE/DELETE/DDL, single-statement only (multi-statement input is rejected outright, write or not — ambiguity about what actually ran is a real risk for a stacked-statement write). This is a genuinely new capability (previously nothing in this codebase let a user run arbitrary write SQL against a connected database through an API) — flagging explicitly for #10's security sign-off rather than treating "role-gated + tested" as equivalent to "reviewed and approved for production."

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 10 task files. 0/9 FRs fully done. Current codebase has NL-to-SQL in the query router (misplaced scope) and no actual SQL editor or direct execution endpoint.
- 2026-07-11 — Tasks #1–#6, #8 built end-to-end; #9 tests partial. 8/9 FRs done (only FR7 open, and it's a product-decision block, not a build gap — see FR7 row above).
  - **Backend:** `sqlparse` added to `requirements.txt` (was already imported by a pre-existing `statement_classifier.py` from an earlier session but never actually installed in the container — would have crashed on first use). New `query_execution_service.py`: classifies via `statement_classifier`, executes SELECT through the existing connector `execute_query()` path (paginated/capped in Python since there's no cursor support beneath it), and executes writes through a **dedicated** cursor + explicit `commit()` — reusing `execute_query()` for writes would have silently rolled them back on connection close, since it was only ever exercised by NL2SQL's read-only path before. New `SavedQuery` model, new `query_studio.py` router (`/execute`, `/history`, `/export`, `/saved` CRUD) at `/api/v1/query-studio`, gated with the existing `require_role("admin"|"analyst")` dependency (matching the pattern already used by semantic/autopilot/schema_catalog) — this is the first Query Studio surface with any auth at all. History is deliberately **not** a new table — it's a query over the audit log (`module=query_studio`, `actor=current_user`), reusing the Audit Trail infrastructure built earlier this session instead of duplicating storage.
  - **Frontend:** replaced the mislabeled NL-to-SQL chat UI at `/dashboard/query-studio` with a real SQL editor — CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-sql`, new deps), dialect-aware highlighting, schema-aware autocomplete sourced from the existing Schema Intel catalog endpoint, a write-confirmation modal, paginated results table, history/saved-queries sidebar, CSV export.
  - **Tests:** `backend/tests/query_studio/` (26 tests) — verified with a real SQLite file connection that a confirmed admin write actually persists (re-queries after the connector closes, proving the explicit commit works, not just that the endpoint returned 200), that non-admin/unconfirmed writes touch nothing, that multi-statement input is rejected, and that history/saved-queries are correctly scoped per user (caught and fixed a test-authoring bug along the way: two `client_*` fixtures used simultaneously both mutate the same global `app.dependency_overrides`, so the second one silently wins for *all* requests regardless of which client variable makes the call — fixed with a `switch_user()` helper that changes identity sequentially instead of stacking fixtures). `frontend/.../query-studio/__tests__/` (5 tests).
  - **Verified:** backend pytest 458/458 (up from 442), frontend tsc/build clean, lint zero new problems, vitest 81/81 (up from 76). Live: rebuilt `api`/`worker`/`beat`/`frontend`, ran real SQL against the seeded SQLite connections through the actual container over curl (list-tables SELECT, a blocked-then-confirmed write, saved-query CRUD, CSV export) and confirmed the `/dashboard/query-studio` page serves. **Observation (not fixed, pre-existing):** adding a new table makes one of gunicorn's two boot workers lose a `Base.metadata.create_all()` race against the other (duplicate-key on the new table's sequence) — harmless since the other worker succeeds and the container reports healthy, but this will recur for every future schema addition; worth a real fix (e.g. an advisory lock around create_all, or a single-worker migration step) at some point given how often this repo adds tables without a migration tool.
  - **Open:** FR7 (send-to-Visualize) needs a product decision before it's buildable — flagged, not guessed at. #10 security sign-off not attempted — this is the epic's first arbitrary-write-execution surface and should get real review before production use, not just "tests pass." **Uncommitted.**
- 2026-07-11 (same day, after AskData Bot) — `page.tsx` gained a mount-time effect consuming an `sessionStorage["qs-handoff"]` payload (`{connectionId, sql}`) written by AskData's new "Edit in Query Studio →" button — see `askdata_bot_tasks/INDEX.md`'s progress log for the AskData-side detail. Query Studio itself didn't need a new endpoint for this; it's a pure frontend receive-side addition. 1 new test (`loads a query handed off from AskData via sessionStorage`).