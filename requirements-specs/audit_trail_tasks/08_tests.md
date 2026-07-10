# Task #8 — Tests (AUDIT-T8)

**TRD reference:** §12 DoD.

**Current state:** The existing `tests/` directory has no `audit/` subdirectory. Some audit tests may exist in other modules' test directories.

## Scope

Build a comprehensive test suite covering all Audit Trail functionality, with special emphasis on immutability, tamper-evidence, ingestion durability, and search correctness.

### Test suite structure

- `tests/audit/test_canonical_schema.py` — AUDIT-T1 schema validation, serialization.
- `tests/audit/test_ingestion.py` — AUDIT-T2 batch ingestion, validation, buffering, backpressure.
- `tests/audit/test_tamper_evidence.py` — AUDIT-T3 hash chain correctness, tamper detection, append-only enforcement.
- `tests/audit/test_search_filter.py` — AUDIT-T4 filtering, faceted search, correlation tracing, pagination.
- `tests/audit/test_export.py` — AUDIT-T6 CSV/JSON export correctness.
- `tests/audit/test_retention.py` — AUDIT-T7 retention calculation, batch cleanup, dry-run.
- `tests/audit/test_role_gating.py` — AUDIT-T7 role-based access control.

### Test categories

- **Unit tests** — Schema validation, hash computation, retention calculation.
- **Integration tests** — Ingestion pipeline, search filters with real DB, export streaming.
- **Security tests** — Append-only (no PUT/DELETE), tamper detection, role gating.
- **Performance tests** — Search response times, ingestion throughput.

### Dependencies

- All tasks AUDIT-T1 through AUDIT-T7 must be complete.

## Verify

```bash
cd backend && .venv/bin/pytest tests/audit/ -v
```

- All unit/integration/security tests pass.
- Tamper-evidence tests verify hash chain integrity end-to-end.
- Performance tests stay within NFR thresholds (ingestion ≤ 200ms p95, search ≤ 2s).

## Risk

Low.