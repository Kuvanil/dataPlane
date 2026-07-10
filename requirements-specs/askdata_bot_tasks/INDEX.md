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
| FR1 | User asks NL question in chat session | **PARTIAL** — `/chat` endpoint exists but is a general intelligence Q&A, not an NL-to-SQL chat | ADB-T1, ADB-T4 |
| FR2 | Generate SQL grounded in Schema Intel catalog | **PARTIAL** — `/nl2sql` exists but doesn't ground in the catalog; uses basic schema context | ADB-T1 |
| FR3 | Display generated SQL alongside answer | **NOT DONE** — no SQL display in response | ADB-T1, ADB-T4 |
| FR4 | Execute only read statements; block writes/DDL | **NOT DONE** — no statement classifier or write-blocking | ADB-T2 |
| FR5 | NL summary + result table + option to visualize | **NOT DONE** — returns raw results, no summary or visualize handoff | ADB-T3, ADB-T6 |
| FR6 | Respect role-scoped data; exclude restricted PII | **NOT DONE** — no role/PII guardrails on execution | ADB-T2 |
| FR7 | Send generated query to Query Studio for editing | **NOT DONE** — no handoff endpoint | ADB-T6 |
| FR8 | Maintain conversation context for follow-ups | **PARTIAL** — ChatMessage model exists with session_id, context isn't session-specific for NL-to-SQL | ADB-T5 |
| FR9 | Emit audit events for question, SQL, execution | **NOT DONE** — no audit emission | ADB-T7 |

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
| [01](01_nl2sql_generation_grounding.md) | FR2, §11 Pipeline | [ ] | NL-to-SQL generation + Schema Intel grounding — rewrite the generation pipeline to ground in the discovered catalog, produce transparent SQL output, and support follow-up context |
| [02](02_readonly_validation_guardrails.md) | FR4, FR6, Security NFR | [ ] | Read-only validation + PII/role guardrails — statement classifier, write-blocking, PII column masking, role-scoped result filtering |
| [03](03_safe_execution_summarization.md) | FR5, Performance NFR | [ ] | Safe execution + result summarization — execute grounded SQL, return NL summary + result table, handle timeouts/large results |
| [04](04_chat_ui_sql_display.md) | FR1, FR3, FR8, Usability NFR | [ ] | Chat UI + SQL display — conversational interface with SQL transparency, connection selector, suggested follow-ups, sidebar indicator |
| [05](05_conversation_context.md) | FR8 | [ ] | Conversation context handling — session-scoped context management for follow-up questions, context window management |
| [06](06_handoffs_visualize_query_studio.md) | FR5, FR7 | [ ] | Visualize + Query Studio handoffs — "Edit in Query Studio" and "Visualize" buttons from chat messages |
| [07](07_audit_emission.md) | FR9 | [ ] | Audit emission — emit audit events for each NL question, generated SQL, and execution outcome |
| [08](08_eval_harness_tests.md) | §12 DoD | [ ] | Eval harness + tests — evaluation dataset, accuracy/grounding eval, test suite for all guardrails |
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
- Database intelligence Q&A (the current AskData — this will be deprecated or realigned).

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 9 task files. 0/9 FRs fully done. Current codebase implements a different product (DB intelligence assistant), not the conversational NL-to-SQL bot specified in the TRD.