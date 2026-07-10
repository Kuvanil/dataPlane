# Task #1 — NL-to-SQL generation + Schema Intel grounding (ADB-T1)

**TRD reference:** FR2 (§4), §11 Pipeline: `retrieve catalog → generate SQL → validate → execute → summarize`.

**Current state:** `backend/app/services/nl2sql_service.py` exists with a basic `NL2SQLService` that generates SQL using Ollama + schema context retrieved via `SchemaService.get_full_schema()`. The `askdata.py` router has a `/nl2sql` endpoint that enqueues a Celery task (`nl2sql_task`). The `query.py` router has a *separate* `/nl2sql` endpoint that calls `NL2SQLService.generate_sql()` directly. Neither endpoint grounds generation in the Schema Intel catalog (discovered tables, columns, types, classifications). There is no display of generated SQL in the response (the `/chat` endpoint returns only an answer text, no SQL).

## Scope

Rewrite the NL-to-SQL generation pipeline to ground SQL generation in the Schema Intel catalog, produce transparent SQL output, and establish a single clear endpoint for AskData's NL-to-SQL chat.

### Backend — `backend/app/services/askdata_nl2sql_service.py` (new, or significantly rework `nl2sql_service.py`)

Create a dedicated AskData NL-to-SQL service distinct from the current `NL2SQLService` (which is used by Query Studio). The new service should:

1. **Catalog grounding** — On receiving a question + connection_id, retrieve the full Schema Intel catalog for that connection (tables, columns, types, primary keys, foreign keys, classifications). Pass this as grounding context to the LLM prompt. Do NOT pass raw row data — only metadata.

2. **Prompt engineering** — Build a structured prompt with:
   - Catalog metadata (tables, columns, types, relationships)
   - The user's question
   - Conversation history (last N exchanges for follow-up context)
   - Instructions: generate only SELECT statements; never DDL/DML; use only entities from the catalog; mark uncertainty.
   - Output format: `{"sql": "...", "confidence": 0-100, "explanation": "..."}`
   - Required: "I cannot generate a valid SQL statement" when confidence < threshold

3. **SQL generation endpoint** — Add `POST /askdata/nl2sql` returning:
   ```json
   {
     "question": "How many active customers last month?",
     "generated_sql": "SELECT COUNT(*) FROM customers WHERE status = 'active' AND created_at >= date('now', '-1 month')",
     "confidence": 92,
     "tables_used": ["customers"],
     "explanation": "Counting customers with active status in the last month"
   }
   ```
   This endpoint should be synchronous for typical responses (≤6s p95 per TRD). If generation will exceed this, enqueue and return a task_id for polling.

4. **Consolidate architecture** — The `query.py` router's `/nl2sql` endpoint should be deprecated or redirected to askdata router. The two routers shouldn't maintain duplicate NL-to-SQL pipelines. The AskData endpoint is for conversational NL → SQL; Query Studio's endpoint (QS-T1) is for direct query execution.

5. **Transparency** — Always include the generated SQL in the response (FR3). The chat UI can then display it alongside the answer.

### API Contract

```
POST /askdata/nl2sql
Request: { "message": string, "connection_id": int, "session_id": string }
Response: {
  "question": string,
  "generated_sql": string | null,
  "confidence": int,
  "explanation": string | null,
  "tables_used": list[string],
  "needs_clarification": bool,
  "clarification_question": string | null
}
```

### Frontend contract (for task #4)

The frontend expects:
- A `POST /askdata/message` endpoint (or reuse `/chat` with NL-to-SQL mode) that returns the above schema.
- Streaming or synchronous response as appropriate.
- Explicit SQL text to render in a code block.

## Dependencies

- **Schema Intel** — catalog search/retrieval API must be available (`GET /api/v1/catalog/search`, `GET /api/v1/catalog/connection/{id}`). Confirmed this exists via `schema_intel_tasks/01` and `04`.
- **LLM/generation service** — the current Ollama integration can be reused but the prompt needs restructuring.
- **Task #5 (conversation context)** — session-scoped history is needed for follow-up questions.

## Edge cases

- **Unknown connection/no catalog** — Return an error asking the user to select/configure a connection first.
- **Zero catalog tables** — Return "No tables discovered for this connection. Run schema discovery first."
- **Ambiguous question** — Return `needs_clarification: true` with a clarification question.
- **Non-existent table referenced by user** — Generation should only produce SQL using validated catalog entities. If the user asks about a table not in the catalog, respond that it wasn't found.
- **Table/column name ambiguity** — Include schema-qualified names in the prompt to disambiguate.
- **Multi-turn context** — Follow-up questions like "how about last quarter?" should inherit the connection and context from the previous turn.

## Verify

```bash
cd backend && .venv/bin/pytest tests/askdata/ -v
```

- Test that generated SQL references only tables/columns from the catalog.
- Test that confidence < threshold returns clarification request.
- Test that SQL is always included in response.
- Test multi-turn context carries connection_id forward.
- Test that raw data is never included in the LLM prompt.
- Test end-to-end: question → grounded SQL → response with SQL.

## Risk

Medium. The core LLM integration exists but the prompting strategy and catalog grounding need careful engineering. Hallucinated tables/columns are the primary risk — mitigated by restricting generation to discovered catalog entities and validating the generated SQL's table/column references before returning.