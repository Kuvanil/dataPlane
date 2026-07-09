# Bug 06: Only 6 of 14 planned test modules exist

- **Severity:** Low
- **File:** `backend/tests/connectors/` — only 6 test modules of 14 planned
- **Status:** Open

## Description

Task #9 defines 14 test modules with a target of ~75 tests. The actual test directory has only 6 modules with 69 tests. While 69 tests is close to 75, the missing modules cover important areas.

## Planned vs Actual

| Planned Module | Exists? | Actual Tests |
|----------------|---------|--------------|
| `test_connection_model.py` | ❌ | Covered inline in `test_connection_service.py` |
| `test_connection_service.py` | ✅ | 17 tests |
| `test_connectors_router.py` | ✅ | 17 tests |
| `test_connector_catalog.py` | ✅ | 12 tests |
| `test_secret_manager.py` | ❌ | Blocked on #2 |
| `test_health_checks.py` | ✅ | 5 tests |
| `test_diagnostics.py` | ✅ | 9 tests |
| `test_soft_delete.py` | ❌ | Covered inline in `test_connection_service.py` |
| `test_discovery.py` | ✅ | 6 tests |
| `test_credential_rotation.py` | ❌ | Blocked on #2/#8 |
| `test_audit.py` | ❌ | Covered inline in other modules |
| `test_connector_implementations.py` | ❌ | Missing completely |

## Impact

- **Low** — the existing 69 tests cover the core paths well.
- The missing `test_connector_implementations.py` means the individual connector drivers (MySQL, Oracle, etc.) have no instantiation or config validation tests.

## Suggested Fix

Add `test_connector_implementations.py` with at minimum:
- Each driver can be instantiated with valid config
- Each returns correct type info
- Each handles missing config fields gracefully

The other missing modules are acceptable as they're either blocked on dependencies (#2/#8) or their coverage is subsumed by existing tests.