# Task #9 — Tests (QS-T9)

**TRD reference:** §12 DoD.

**Current state:** No Query Studio-specific tests exist. The `tests/` directory has no `query_studio/` subdirectory.

## Scope

Build a comprehensive test suite covering all Query Studio functionality.

### Test suite structure

- `tests/query_studio/test_execution.py` — QS-T1 execution, pagination, timeout.
- `tests/query_studio/test_statement_classifier.py` — QS-T2 classification.
- `tests/query_studio/test_write_gating.py` — QS-T3 write confirmation flow.
- `tests/query_studio/test_saved_queries.py` — QS-T6 CRUD operations.
- `tests/query_studio/test_handoffs.py` — QS-T7 visualize handoff.
- `tests/query_studio/test_audit.py` — QS-T8 audit emission.
- `tests/query_studio/test_api_contract.py` — Request/response format for all endpoints.

### Test categories

- **Unit tests** — Statement classifier, write gating logic.
- **Integration tests** — Execution pipeline with real DB connection (SQLite in-memory).
- **API contract tests** — All endpoints with expected request/response shapes.
- **Security tests** — Write gating, role enforcement.

### Dependencies

- All tasks QS-T1 through QS-T8 must be complete.
- Test infrastructure from existing patterns (`backend/tests/` conftest).

## Verify

```bash
cd backend && .venv/bin/pytest tests/query_studio/ -v --cov=app.services.query_studio
```

## Risk

Low.