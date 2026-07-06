# Task #9 — Connector tests (CONN-T9)

**TRD reference:** §12 DoD, §5 Security NFR.

**Current state:** There are no dedicated connector tests. The existing `backend/tests/` directory has test suites for Schema Mapper (`tests/mapping/`), Pipelines (`tests/pipelines/`), and Schema Intel (`tests/schema_catalog/`), but no `tests/connectors/` directory. The individual connector implementations (postgres, mysql, oracle, sqlite, jdbc) have no test coverage at all.

## Scope

Create a comprehensive test suite for the connectors module, mirroring the pattern established in `tests/mapping/` and `tests/schema_catalog/`.

### Test directory structure

```
backend/tests/connectors/
├── __init__.py
├── conftest.py              # Shared fixtures (in-memory DB, mock connectors, sample configs)
├── test_connection_model.py  # DBConnection model CRUD + soft-delete + health status
├── test_connection_service.py # ConnectionService methods
├── test_connectors_router.py # REST API endpoints (create, list, get, update, delete, test, discover, rotate)
├── test_connector_catalog.py # Connector types catalog metadata
├── test_secret_manager.py   # Encryption, storage, retrieval, rotation, deletion
├── test_health_checks.py    # Health check scheduler + status aggregation
├── test_diagnostics.py      # Test Connection diagnostics + timeout + error classification
├── test_soft_delete.py      # Dependency-aware soft delete + restore + hard delete
├── test_discovery.py        # Schema discovery handoff + snapshot + Schema Intel integration
├── test_credential_rotation.py # Credential rotation with/without test + edge cases
├── test_audit.py            # Audit events for all connector actions
└── test_connector_implementations.py # Driver-level tests for each connector type
```

### Conftest fixtures — `backend/tests/connectors/conftest.py`

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base
from app.models.connection import DBConnection
from app.models.connection_secret import ConnectionSecret

@pytest.fixture
def engine():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def sample_postgres_conn(db):
    """Create a sample Postgres connection in the DB."""
    conn = DBConnection(
        name="test-pg",
        type="postgres",
        config={"host": "localhost", "port": 5432, "dbname": "testdb", "user": "testuser"},
        created_at=datetime.utcnow(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn

@pytest.fixture
def sample_sqlite_conn(db):
    """Create a sample SQLite connection in the DB."""
    conn = DBConnection(
        name="test-sqlite",
        type="sqlite",
        config={"path": "/data/test.db"},
        created_at=datetime.utcnow(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn

@pytest.fixture
def mock_connector(monkeypatch):
    """Mock the connector driver to avoid real DB connections."""
    from app.connectors.base import BaseConnector, TestConnectionResult

    class MockConnector(BaseConnector):
        def __init__(self, config):
            self.config = config
        def connect(self):
            return None
        def test_connection(self):
            return TestConnectionResult(success=True, reachable=True, authenticated=True,
                                        database_accessible=True, version="MockDB 1.0", latency_ms=5)
        def get_tables(self):
            return ["users", "orders"]
        def get_table_schema(self, table_name):
            return [
                {"name": "id", "type": "INTEGER", "nullable": False, "primary_key": True},
                {"name": "name", "type": "TEXT", "nullable": True, "primary_key": False},
            ]
        def close(self):
            pass

    def _mock_get_connector(conn_type):
        return lambda config: MockConnector(config)

    monkeypatch.setattr("app.services.schema_service.get_connector", _mock_get_connector)
    return MockConnector
```

### Test coverage goals per module

| Module | Minimum tests | What to test |
|--------|---------------|--------------|
| `test_connection_model.py` | 8 | Create, read, update, delete (soft), restore, filter deleted, health status transitions, unique constraint with deleted |
| `test_connection_service.py` | 6 | Service CRUD methods, health update, get_dependents with/without related models |
| `test_connectors_router.py` | 12 | All CRUD endpoints, validation errors, 404s, 409s, auth gating |
| `test_connector_catalog.py` | 5 | Types list, single type, unknown type, field structure, secret_fields mapping |
| `test_secret_manager.py` | 8 | Store, retrieve, rotate, delete, key rotation, backfill, SQLite no-op, race condition |
| `test_health_checks.py` | 6 | Task dispatch, healthy/degraded/down transitions, rate limiting, deleted-skip, health-summary endpoint |
| `test_diagnostics.py` | 7 | Success response shape, timeout, auth failure, unreachable, error classification, concurrent tests, SQLite diagnostics |
| `test_soft_delete.py` | 8 | Soft delete no-dependents, with dependents (warning + confirm flow), restore, hard delete, hard-delete with active dependents blocked, name collision on restore, list deleted |
| `test_discovery.py` | 6 | Snapshot creation, hash computation, Schema Intel handoff, empty schema, deleted-connection 404, graceful degradation when Intel unavailable |
| `test_credential_rotation.py` | 7 | Successful rotation, failed test preserves old, skip-test flag, SQLite 422, unmigrated backfill, audit emission, invalid secret fields rejected |
| `test_audit.py` | 5 | Events emitted for each action type, correct payload, actor recorded, secrets never in audit, timestamp |
| `test_connector_implementations.py` | 5 | Each connector driver can be instantiated with valid config, each returns correct type info, each handles missing config fields gracefully |

### Total test count: ~75 tests minimum

## Dependencies

- All tasks #1–#8 (tests are end-to-end verification of functionality).

## Edge cases in testing

- **No real databases available:** All connector driver tests must use either in-memory SQLite (for the SQLite connector) or well-mocked connections (for Postgres/MySQL/Oracle/JDBC). The `mock_connector` fixture provides a default mock; individual tests can override with failure-inducing mocks.
- **Time-sensitive tests:** The health check scheduler tests must not depend on actual Celery. Test the task logic directly (call the function, assert side effects). Use `unittest.mock.patch` for the Celery `delay()` call.
- **Secret manager tests without real encryption key:** The AES-256-GCM tests need a test key. Generate one in the test setup (`os.urandom(32)` base64-encoded). Don't rely on the `SECRETS_ENCRYPTION_KEY` env var (it may not be set in CI).
- **Dependency check with missing models:** The soft-delete tests should test the graceful degradation path: temporarily remove `Mapping` or `Pipeline` from `sys.modules` to simulate the model not existing, and assert the delete proceeds with a warning log.
- **Audit trail isolation:** Audit tests should use an in-memory SQLite database and check the `audit_log` table directly (assuming `record_audit` persists to a known model). If `AuditLog` isn't in memory, use `unittest.mock` to capture the call arguments.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v --tb=short
```

- All ~75+ tests pass.
- Coverage report shows:
  - `backend/app/models/connection.py` — 95%+ coverage (all branches: soft-delete filtering, health transitions)
  - `backend/app/services/connection_service.py` — 90%+
  - `backend/app/services/secret_manager.py` — 95%+ (including error paths: missing key, corrupt ciphertext)
  - `backend/app/api/routers/connectors.py` — 90%+ (all endpoints, all error codes)
  - `backend/app/services/connector_catalog.py` — 100% (static data — trivial)
  - `backend/app/tasks/connector_tasks.py` — 85%+ (happy path + retry exhaustion)
  - `backend/app/connectors/*.py` — 70%+ (base class testability depends on each connector's instantiation path)

## Risk

Low-medium. The main challenge is mocking the connector drivers without hitting real databases. The `mock_connector` fixture provides a clean abstraction. The implementation tests for each connector type (postgres, mysql, oracle, jdbc) are inherently limited by the lack of real instances — they test construction and config validation, not actual connectivity. Actual connectivity tests belong in the integration/E2E test suite, not here.