# Task #1 — Register AI-suggestion task with Celery worker

**Reviewer finding:** §11.1 (CRITICAL) — `celery_app.py` only includes
`app.tasks.ai_tasks`. The `app.workers.mapping_tasks.suggest_mappings_task` is
imported nowhere in the worker's module graph. Every "Get AI Suggestions" click
in production silently does nothing — FR4, FR5, AC2 are non-functional in the
deployed stack.

**Bundled with #5** (§11.5 — O(columns × tables) LLM-call blow-up) because both
live in `mapping_tasks.py` and `mapping_service.py` and will be touched together.

## Changes

### 1. `backend/app/core/celery_app.py`
Add `app.workers.mapping_tasks` to the `include` list.

### 2. `backend/app/services/mapping_service.py`
Import the task object directly and call `.delay(...)` instead of
`celery_app.send_task(..., name=...)`. This makes a future typo fail at import
time, not silently at runtime.

### 3. `backend/app/workers/mapping_tasks.py`
Hoist `AIService.match_schemas(...)` out of the column loop:
- **Before:** `Σ(target_columns) × Σ(source_tables)` LLM calls
- **After:** `Σ(target_tables) × Σ(source_tables)` LLM calls

The match result is distributed to unmapped target columns by name. This
matches the NFR's "per single target table" framing (TRD §5).

### 4. New test `backend/tests/mapping/test_celery_registration.py`
Asserts `celery_app.tasks` contains the AI suggestion task name after
importing `app.core.celery_app` the way the worker entrypoint does. Would
have caught this bug at CI time.

## Verify

```bash
cd backend && .venv/bin/pytest tests/mapping/ -v
```

Must remain 69+/69+.

## Risk

- Changing `send_task` → `task.delay()` changes the AsyncResult interface
  slightly (`.delay()` returns an `EagerResult` in test mode, which still
  satisfies `.id` access). Verified by existing e2e smoke test.
- The hoisted `match_schemas` call now processes ALL unmapped target columns
  in one call instead of one column at a time. The AI service prompt format
  already accepts a list of columns; this is a strict performance win.
