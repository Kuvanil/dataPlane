# AskData Bot (DP-ADB-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_AskData_Bot.md` (9 FRs, 8 subtasks, ~29 days estimated = ~6 weeks).
> Scope: NL-to-SQL generation grounded in Schema Intel catalog, read-only execution with guardrails, chat UI with SQL transparency, conversation context, handoffs to Visualize and Query Studio, audit emission.
>
> **2026-07-09 audit:** The codebase has a working foundation — `AskDataService` (`backend/app/services/askdata_service.py`) with LLM (Ollama) + pattern-matching fallback for a **database intelligence assistant** (schema analysis, PII detection, health assessment), `ChatMessage` model (`backend/app/models/chat_session.py`), and `askdata.py` router (`backend/app/api/routers/askdata.py`) with `/chat`, `/nl2sql`, `/suggestions`, `/delete/session/{session_id}`. What's **different from the TRD**:
>
> - The current AskData is a **database intelligence assistant** (answers "what PII risks exist?", "show schema gaps") — NOT a **conversational NL-to-SQL bot** that generates and executes grounded SQL. The TRD envisions a fundamentally different product: user asks "How many active customers last month?" → bot generates grounded SQL → shows SQL → executes → returns summary + table.
> - The existing `/nl2sql` endpoint in `askdata.py` enqueues a Celery task (`nl2sql_task`) but the response surface is minimal (just a task_id). No display of generated SQL, no read-only validation, no guardrails.
> - The `query.py` router has a separate `/nl2sql` endpoint that uses `NL2SQLService` to generate SQL directly — this duplicates functionality and confuses the architecture boundary between AskData and Query Studio.
> - No audit emission exists on AskData operations.
> - No Visualize or Query Studio handoff endpoints exist.
> - No sidebar active/online indicator exists in the frontend.
> - The ChatMessage model exists but the TRD requires schema-grounded SQL generation with conversation context, not just general Q&A.
>
> **FR1–FR9 verdict (as of 2026-07-09):**

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | User asks NL question in chat session | **DONE** — new `POST /askdata/ask`, real chat UI at `/dashboard/askdata` (the old DB-intelligence chat is left in place, unused by the new page — see Out-of-scope note) | ADB-T1, ADB-T4 |
| FR2 | Generate SQL grounded in Schema Intel catalog | **DONE** — grounds in `SchemaCatalogService.get_catalog()`; falls back to live introspection (flagged `grounded: false`) if the connection hasn't been scanned yet | ADB-T1 |
| FR3 | Display generated SQL alongside answer | **DONE** — collapsible "Show SQL" per chat turn | ADB-T1, ADB-T4 |
| FR4 | Execute only read statements; block writes/DDL | **DONE** — reuses Query Studio's `statement_classifier`; anything not classified SELECT is refused outright, no execution attempt | ADB-T2 |
| FR5 | NL summary + result table + option to visualize | **PARTIAL** — summary + result table done (deterministic, not LLM-generated); "visualize" option **not attempted** — same product-decision block as Query Studio's FR7 (`/dashboard/visualize` is a schema graph, not a chart surface for arbitrary result sets) | ADB-T3, ADB-T6 |
| FR6 | Respect role-scoped data; exclude restricted PII | **DONE** — `viewer` role gets High-risk columns (via `SecurityService`'s existing keyword classifier) redacted to `***REDACTED***`; admin/analyst see unmasked | ADB-T2 |
| FR7 | Send generated query to Query Studio for editing | **DONE** — "Edit in Query Studio →" button hands off `{connection_id, sql}` via `sessionStorage`; Query Studio consumes it on mount | ADB-T6 |
| FR8 | Maintain conversation context for follow-ups | **DONE** — recent turns (`role: content`) folded into the question text sent to `NL2SQLService.generate_sql` (see #1's known-tradeoff note) | ADB-T5 |
| FR9 | Emit audit events for question, SQL, execution | **DONE** — `askdata.question_answered` via `emit_audit_event`, verified live in the real audit log | ADB-T7 |

**8 of 9 FRs fully done; 1 partially done (FR5's visualize sub-part, a product decision block); 0 not done.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_nl2sql_generation_grounding.md) | FR2, §11 Pipeline | [x] | NL-to-SQL generation + Schema Intel grounding — rewrite the generation pipeline to ground in the discovered catalog, produce transparent SQL output, and support follow-up context |
| [02](02_readonly_validation_guardrails.md) | FR4, FR6, Security NFR | [x] | Read-only validation + PII/role guardrails — statement classifier, write-blocking, PII column masking, role-scoped result filtering |
| [03](03_safe_execution_summarization.md) | FR5, Performance NFR | [x] | Safe execution + result summarization — execute grounded SQL, return NL summary + result table, handle timeouts/large results |
| [04](04_chat_ui_sql_display.md) | FR1, FR3, FR8, Usability NFR | [x] | Chat UI + SQL display — conversational interface with SQL transparency, connection selector, suggested follow-ups |
| [05](05_conversation_context.md) | FR8 | [x] | Conversation context handling — session-scoped context management for follow-up questions, context window management |
| [06](06_handoffs_visualize_query_studio.md) | FR5, FR7 | [~] | Handoffs — Query Studio done (session storage handoff, consumed on mount); Visualize **not attempted** — blocked on the same product decision as Query Studio's FR7 |
| [07](07_audit_emission.md) | FR9 | [x] | Audit emission — emit audit events for each NL question, generated SQL, and execution outcome |
| [08](08_eval_harness_tests.md) | §12 DoD | [~] | Tests — `backend/tests/askdata/` (9 tests: grounded/ungrounded generation, PII masking by role, conversation context, audit emission, 404s); no dedicated NL-to-SQL accuracy/grounding eval harness or dataset |
| [09](09_security_signoff.md) | Security NFR, §12 DoD | [ ] | Security sign-off — PII/role guardrails validation, read-only enforcement verification |

## Confidence per task

- **#1 NL-to-SQL generation** — MEDIUM confidence. Requires redesign of the current generation pipeline. The existing `NL2SQLService` (`backend/app/services/nl2sql_service.py`) provides a starting point but needs catalog grounding. Dependency on Schema Intel's catalog API maturity.
- **#2 Read-only validation + guardrails** — MEDIUM-HIGH confidence. Statement classifier is a self-contained component. PII guardrails depend on Schema Intel's classification metadata being available at query time.
- **#3 Safe execution + summarization** — MEDIUM confidence. Depends on Query Studio's execution service (QS-T1) for consistent query execution path. NL summarization needs LLM integration.
- **#4 Chat UI + SQL display** — MEDIUM confidence. Frontend task; no existing chat UI for NL-to-SQL. The current chat endpoint is for a different use case (DB intelligence).
- **#5 Conversation context** — MEDIUM-HIGH confidence. ChatMessage model exists; needs session-scoped schema context management and context window truncation.
- **#6 Visualize + Query Studio handoffs** — HIGH confidence. Simple REST endpoints that hand off context to existing modules.
- **#7 Audit emission** — HIGH confidence. Follows established `record_audit` pattern from connectors.
- **#8 Eval harness + tests** — MEDIUM confidence. Requires representative test dataset for NL-to-SQL evaluation.
- **#9 Security sign-off** — [!] Cross-reference, depends on Security team review.

## Execution order (recommended)

1. **#5 Conversation context** — foundation for session-scoped context, needed by the NL-to-SQL pipeline. Builds on existing ChatMessage model.
2. **#1 NL-to-SQL generation + grounding** — core capability. Must be built before execution (#3) and guardrails (#2) can be integrated.
3. **#2 Read-only validation + guardrails** — safety layer on top of generation. Can be developed in parallel with #1 but must be integrated before #3.
4. **#3 Safe execution + summarization** — depends on #1 (generation) and #2 (guardrails). Also depends on Query Studio's query execution service.
5. **#4 Chat UI + SQL display** — frontend. Can proceed in parallel with backend tasks but needs mockable API contract from #1.
6. **#6 Handoffs** — depends on Visualize and Query Studio being available. Can be developed after core UX is stable.
7. **#7 Audit emission** — depends on #1, #2, #3 having clear event points. Can be integrated incrementally.
8. **#8 Eval harness + tests** — incremental, built as each component lands.
9. **#9 Security sign-off** — cross-team, pursue in parallel.

## Out of scope (confirmed, per TRD §2)

- Free-form write/DDL generation and execution.
- Manual SQL authoring (owned by Query Studio).
- Model training/fine-tuning (separate ML task).
- Connection management (owned by Connectors).
- Database intelligence Q&A (the current AskData — ~~this will be deprecated or realigned~~ **realigned 2026-07-11**: `/dashboard/askdata` now serves the conversational NL-to-SQL bot. The old `/chat`, `/suggestions`, `/nl2sql` (Celery-task) endpoints in `askdata.py` and `AskDataService` itself were left in place — nothing else calls them — but are dead code from the frontend's perspective now. Not deleted since removing a whole service/endpoint set wasn't asked for and there was no cost to leaving it; flagging here so a future cleanup pass knows it's safe to remove.

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 9 task files. 0/9 FRs fully done. Current codebase implements a different product (DB intelligence assistant), not the conversational NL-to-SQL bot specified in the TRD.
- 2026-07-11 — Tasks #1–#5, #7 done; #6 partial (Query Studio handoff only); #8 partial (tests, no eval harness). 8/9 FRs done (FR5's visualize sub-part is the only gap, and it's a product decision, not a build gap — same one flagged in Query Studio's own INDEX same day). Built the same day as Query Studio, which this depends on (ADB-T3 → QS-T1) and which was finished first.
  - **Backend:** new `askdata_pipeline_service.py` — grounds in the persisted Schema Intel catalog (`SchemaCatalogService.get_catalog`), falling back to live schema introspection with `grounded: false` if the connection hasn't been scanned; reuses `NL2SQLService.generate_sql` for the actual Ollama-or-template generation rather than forking it (shared with the legacy `query.py` NL2SQL surface); reuses the **same** `statement_classifier` Query Studio uses to refuse anything that isn't a plain SELECT (AskData must never write, unlike Query Studio's gated write path); PII masking for the `viewer` role via `SecurityService`'s existing keyword-based column classifier (schema_intel's own persisted classification is still incomplete per that epic's INDEX — this is an honest, functional interim, not a blocker). Conversation context is folded into the question text passed to `generate_sql` (that function has no history parameter) — documented tradeoff: the fast-path template matcher also sees the history-prefixed text, so a prior turn containing an exact fast-path phrase could in theory misfire a later turn down that path; judged low-risk given how specific those phrases are. Summarization is deterministic (row-count/single-value framing), not another LLM call — same reasoning as Autopilot's decision to keep its decision path LLM-free. Extended `ChatMessage` (`connection_id`, `sql_text`, `row_count`, all nullable) rather than a new table, since conversation history IS chat history; this is an **additive schema change to an existing, already-populated table** — `create_all()` doesn't retroactively alter it, so the dev Postgres needed a manual `ALTER TABLE chat_messages ADD COLUMN ...` (same category of gotcha the connectors epic hit first — recorded there and now here). New `POST /askdata/ask` and `GET /askdata/sessions/{id}/messages`; the old `/chat`/`/nl2sql`/`/suggestions` endpoints were left as dead code (see Out-of-scope note) rather than deleted.
  - **Frontend:** replaced the old canned-response "database intelligence" chat at `/dashboard/askdata` with a real chat UI — connection picker, per-turn collapsible SQL, result table, masked-columns notice, "not grounded" warning when the connection hasn't been scanned, and an "Edit in Query Studio →" handoff button that writes `{connectionId, sql}` to `sessionStorage` and navigates; Query Studio's `page.tsx` gained a mount-time effect that consumes and clears that key.
  - **Tests:** `backend/tests/askdata/` (9 tests) — grounded generation against a seeded catalog, live-schema fallback for an unscanned connection, PII masking for viewer vs. not for analyst, conversation context persisting across turns via the messages endpoint, audit emission, 404s. Ollama isn't reachable in the test venv, so `OLLAMA_MAX_RETRIES` is monkeypatched to 0 in conftest to skip retry backoff sleep and fall through to the deterministic heuristic generator fast (without this, each LLM-attempting test cost ~3s in connection-refused retries). `frontend/.../askdata/__tests__/` (5 tests) — needed `Element.prototype.scrollIntoView` stubbed (jsdom doesn't implement it; used to keep the latest turn in view).
  - **Verified:** backend pytest 467/467 (up from 458), frontend tsc/build clean, lint zero new problems, vitest 87/87 (up from 81). Live: rebuilt `api`/`worker`/`beat`/`frontend`, ran the `ALTER TABLE`, then exercised the real stack end-to-end over curl — scanned a connection into the catalog, asked a grounded question that actually round-tripped through the real Ollama container (`method: "llm"`, not just the heuristic fallback), ran a follow-up in the same session, fetched session messages, created a temporary viewer-role user and confirmed `email`/`phone_number`/`email_address` came back `***REDACTED***` for them but not for admin, and confirmed the audit trail recorded the exchange (`module=askdata`, `event_type=askdata.question_answered`) — then deleted the temporary user.
  - **Open:** FR5's visualize option blocked on the same product decision as Query Studio; #9 security sign-off not attempted (PII masking here relies on Schema Intel's still-partial classifier, and read-only enforcement should get real review, not just green tests, before this is used against anything sensitive). **Uncommitted.**