# Task #10 — Extensible intent registry + clarifying-question flow

**Reference:** TRD §5 FR8/FR10; INDEX.md design decision #4. Depends only on #1's classification
existing; independent of #2-#9, can be built any time after #1.

**Goal:** Generalize task #1's keyword-based classifier into a registry future request types can
extend without rearchitecting — the user's own framing ("the questions may vary") is the point of
this task — plus build the clarifying-question flow task #1 deferred.

## Changes

### 1. `backend/app/services/dba_intent_classifier.py` (extends task #1)
- Restructure as a registry of intent handlers, mirroring `autopilot_registry.py`'s allow-list
  pattern: each entry declares an intent name, matching signals (keywords/patterns, or eventually a
  small classifier model), and a handler reference (e.g. `schema_design` → task #3's engine;
  `read_query` → existing `NL2SQLService`). Adding a future intent (e.g. "propose an index for a
  slow query," "add a DQ check to an existing table") means registering a new entry, not touching
  the classification core.
- Keep the registry's classification itself deterministic/pattern-based per task #1 — this task is
  about *structure* (extensibility), not about swapping in an LLM classifier; that's a separate,
  future decision if pattern-matching proves insufficient in practice.

### 2. Clarifying-question flow
- When classification confidence is low, or a `schema_design`-classified request is missing a
  resolvable source connection (no connection named/implied, or the implied one doesn't exist), or
  the implied connection has no catalog/profiling yet, `askdata_pipeline_service.ask()` should
  return a clarifying question instead of proceeding — e.g. "Which connection should I use as the
  source for retail analytics?" or "That connection hasn't been scanned yet — want me to scan it
  first?"
- This should compose with AskData's existing conversation-context handling — the clarifying
  answer becomes the next turn's context, not a separate flow bolted on top.

### 3. Tests
- `backend/tests/askdata/test_intent_registry.py` — registering a second dummy intent handler and
  confirming it's dispatched to correctly (proves extensibility, not just that the one built-in
  handler works); clarifying-question tests for each ambiguity case above (missing connection,
  unscanned connection, low-confidence classification).

## Verify

```bash
cd backend && pytest tests/askdata/test_intent_registry.py -v
```
Manually: ask a schema-design request naming a connection that doesn't exist; confirm a clarifying
question comes back instead of a silent guess or a crash.

## Risk

- "How confident is confident enough to proceed without asking" is a judgment call worth a quick
  product check-in rather than a unilateral threshold pick — flag this explicitly if it isn't
  resolved by the time this task is implemented, rather than guessing silently.
