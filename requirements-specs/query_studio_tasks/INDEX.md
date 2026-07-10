# Query Studio (DP-QS-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Query_Studio.md` (9 FRs, 9 subtasks, ~25 days estimated = ~5 weeks).
> Scope: SQL editor with syntax highlighting and schema-aware autocomplete, connection/database selector, read/write statement classification with write gating, paginated query execution, per-user query history, saved queries, send-to-Visualize handoff, CSV export, audit emission.
>
> **2026-07-09 audit:** The codebase has a foundation — `backend/app/api/routers/query.py` with `POST /query/nl2sql` (NL-to-SQL via `NL2SQLService`), `GET /query/report/{connection_id}`, and `GET /query/history`. The `QueryHistory` model (`backend/app/models/query_history.py`) exists. However, this implementation overlaps significantly with AskData Bot's NL-to-SQL scope and doesn't match the Query Studio TRD:

> **FR1–FR9 verdict (as of 2026-07-09):**

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | SQL editor with syntax highlighting + schema-aware autocomplete | **NOT DONE** — no editor UI exists | QS-T4 |
| FR2 | Select execution context (connection/database) before running | **PARTIAL** — history model tracks connection_id but no selector UI exists | QS-T1, QS-T4 |
| FR3 | Execute queries, return paginated results table | **NOT DONE** — `POST /query/nl2sql` executes but is NL-to-SQL, not direct SQL execution with pagination | QS-T1, QS-T5 |
| FR4 | Detect write/DDL, require role + explicit confirmation | **NOT DONE** — no statement classifier or write gating | QS-T2, QS-T3 |
| FR5 | Per-user query history | **PARTIAL** — `QueryHistory` model + `GET /query/history` exist but are NL-to-SQL specific, not general query history | QS-T6 |
| FR6 | Save and name queries, reload them | **NOT DONE** — no saved query model or UI | QS-T6 |
| FR7 | Send result set to Visualize | **NOT DONE** — no handoff endpoint | QS-T7 |
| FR8 | Export results as CSV | **NOT DONE** — no export endpoint | QS-T5 |
| FR9 | Audit event for every executed statement | **NOT DONE** — `record_audit` exists but isn't called from query execution | QS-T8 |

**0 of 9 FRs fully done; 2 partially done; 7 not done.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_query_execution_service_pagination.md) | FR3, §11 API | [ ] | Query execution service + pagination — direct SQL execution endpoint, paginated result streaming, timeout/cancellation, connection context |
| [02](02_statement_classifier_read_write_ddl.md) | FR4, Security NFR | [ ] | Statement classifier (read/write/DDL) — classifier for input SQL, multi-statement detection, metadata extraction (tables, columns) |
| [03](03_write_statement_gating_confirmation.md) | FR4 | [ ] | Write-statement gating + confirmation — role-based write permission check, explicit user confirmation flow, write-blocked error paths |
| [04](04_editor_syntax_highlighting_autocomplete.md) | FR1, FR2, Usability NFR | [ ] | SQL editor UI — syntax highlighting, schema-aware autocomplete from Schema Intel, formatting, connection selector |
| [05](05_results_table_export_csv.md) | FR3, FR8 | [ ] | Results table + CSV export — paginated results view, column sorting, CSV download, large result handling |
| [06](06_history_saved_queries.md) | FR5, FR6 | [ ] | History + saved queries — per-user query history viewer, save/load/named queries, reload into editor |
| [07](07_send_to_visualize_handoff.md) | FR7 | [ ] | Send-to-Visualize handoff — endpoint to pass result set to Visualize for charting |
| [08](08_audit_emission.md) | FR9 | [ ] | Audit emission — emit audit events for every statement execution with full context |
| [09](09_tests.md) | §12 DoD | [ ] | Tests — unit, integration, and E2E tests for all Query Studio functionality |
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

The current `query.py` router's NL-to-SQL endpoint (`POST /query/nl2sql`) overlaps with AskData Bot's scope. Once both epics are implemented, the NL-to-SQL functionality should be removed from Query Studio (the `NL2SQLService` is owned by AskData). Query Studio is the **manual SQL authoring** workspace — users write their own SQL, not NL.

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 10 task files. 0/9 FRs fully done. Current codebase has NL-to-SQL in the query router (misplaced scope) and no actual SQL editor or direct execution endpoint.