# Task #1 — Intent classification gate in AskData

**Reference:** TRD §5 FR1; INDEX.md root-cause audit and design decision #4.

**Goal:** Before `askdata_pipeline_service.ask()` delegates to `NL2SQLService.generate_sql()`,
classify the request's intent. If it isn't a read-query, don't generate SQL at all — respond with
a clear, honest message (and, once later tasks land, route to the planning engine). This is the
smallest, highest-value fix in the epic and should ship independently of everything else.

## Changes

### 1. New: `backend/app/services/dba_intent_classifier.py`
- `classify_intent(question: str) -> IntentClassification`, returning at minimum
  `{intent: "read_query" | "schema_design" | "ambiguous", confidence: float, matched_signal: str}`.
- Start deterministic and keyword/pattern-based, not LLM-based, for this first task — cheap, fast,
  and auditable. Recognize "build" signals: verbs like *create/design/build/generate* combined with
  nouns like *schema/table(s)/pipeline/transformation(s)/data quality*. Recognize clear read-query
  signals (question words, aggregate verbs — *show/count/how many/what is*) to keep the common case
  fast and unambiguous.
- Requests matching neither strongly enough fall into `"ambiguous"` — task #10 builds the
  clarifying-question flow for that bucket; for this task, treat `"ambiguous"` the same as
  `"read_query"` (today's existing behavior) so this task doesn't block on #10 landing first.

### 2. `backend/app/services/askdata_pipeline_service.py`
- Call `classify_intent(question)` at the top of `ask()`, before grounding/generation.
- On `"schema_design"`: **do not** call `NL2SQLService.generate_sql`. Return a response whose
  `summary` clearly states this looks like a schema/pipeline design request, that AskData currently
  only answers read-only questions about existing data, and (once task #3 exists) a pointer to the
  planning capability. Until task #3 ships, this is simply an honest "not supported yet" message —
  a real improvement over a wrong `SELECT` even on its own.
- On `"read_query"`/`"ambiguous"`: unchanged — proceed exactly as today.
- Emit an audit event for the classification itself (e.g. `askdata.intent_classified`,
  `module=askdata`) alongside the existing `askdata.question_answered` event, so classification
  accuracy can be reviewed later from the audit log rather than only from application logs.

### 3. Tests
- `backend/tests/askdata/test_intent_classifier.py` — unit tests for both intent buckets using
  the retail-analytics example verbatim (must classify `"schema_design"`) plus the existing
  read-query test fixtures already in `backend/tests/askdata/` (must stay `"read_query"` — no
  regression on the existing 9 AskData tests).
- Integration test confirming `ask()` short-circuits before calling `NL2SQLService.generate_sql`
  for a `"schema_design"`-classified question (mock/spy the generator and assert it's never
  called).

## Verify

```bash
cd backend && pytest tests/askdata/ -v
```
Manually: ask the exact retail-analytics example in Query Workspace's Ask mode, confirm the
response is now an honest "I can't do that yet" / "here's what I can do" message instead of a
`SELECT * FROM ... LIMIT 50;` query.

## Risk

- Keyword-based classification will misclassify some requests either direction — that's expected
  and acceptable for a first pass; task #10's registry is where this gets more extensible/tunable.
  Don't over-engineer this task trying to get it perfect; ship the clear win (no more silent garbage
  SQL) and iterate.
