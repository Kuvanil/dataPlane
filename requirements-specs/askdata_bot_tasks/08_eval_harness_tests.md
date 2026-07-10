# Task #8 — Eval harness + tests (ADB-T8)

**TRD reference:** §12 DoD, §10 risk mitigation (eval harness).

**Current state:** No AskData-specific tests exist. The existing `NL2SQLService` has no evaluation harness for NL-to-SQL accuracy. No test files exist under `backend/tests/askdata/`.

## Scope

Build an evaluation harness for NL-to-SQL accuracy and a comprehensive test suite covering all AskData functionality.

### Eval harness

1. **Eval dataset** — Create a curated dataset of NL questions with expected SQL and acceptable variations:
   - `tests/askdata/eval_data/products.json` — 20-30 questions for the seed product database.
   - Example: `{"question": "How many active customers?", "expected_sql_pattern": "SELECT COUNT.*FROM customers.*WHERE.*active", "connection": "seed_db"}`.

2. **Eval runner** — `tests/askdata/eval_runner.py` that:
   - For each eval entry: generates SQL via the service, compares to expected pattern.
   - Reports: accuracy (exact match), precision (correct tables/columns), confidence calibration.
   - Outputs a summary table with pass/fail per entry.

3. **Baseline threshold** — The eval harness must meet a baseline accuracy threshold (e.g., 80% exact match, 95% table/column correctness) before the pipeline is considered ready.

### Test suite

- `tests/askdata/test_nl2sql_generation.py`
- `tests/askdata/test_guardrails.py`
- `tests/askdata/test_execution.py`
- `tests/askdata/test_context.py`
- `tests/askdata/test_handoffs.py`
- `tests/askdata/test_audit.py`
- `tests/askdata/test_ui_api.py` (contract tests for the frontend API)

### Test categories

- **Unit tests** — Individual components (classify_statement, filter_pii_columns, context window management).
- **Integration tests** — End-to-end pipeline (mock LLM + real guardrails + mock execution).
- **API contract tests** — Request/response format for all endpoints.
- **Eval tests** — Accuracy benchmarks against curated dataset (run separately, not in CI on every push).
- **Security tests** — Verify guardrails block write statements, PII columns are filtered, role-scoping works.

### Dependencies

- All tasks #1–#7 must be complete for full test coverage.
- Test infrastructure from existing patterns (`backend/tests/connectors/` conftest patterns).

## Verify

```bash
cd backend && .venv/bin/pytest tests/askdata/ -v --cov=app.services.askdata
```

- All unit/integration/API contract tests pass.
- Eval harness runs and meets baseline threshold.
- Guardrail tests block write statements and filter PII columns.
- Audit tests verify event emission at each pipeline stage.

## Risk

Low-Medium. Eval dataset quality directly impacts the usefulness of the harness. The test suite follows established testing patterns from other modules.