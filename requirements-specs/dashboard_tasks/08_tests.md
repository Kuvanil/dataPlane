# Task #8 — Test Suite for Dashboard (DASH-T8)

**TRD reference:** §12 Definition of Done (unit/integration/E2E tests passing).

**Current state:** No test suite exists for the dashboard module. The `dashboard_static_ui_tasks/` work has no tests. The aggregation API (Task #1), caching layer (Task #2), and role-scoping (Task #7) all need test coverage.

## Scope

Create a test suite for the dashboard backend (aggregation API, caching, role-scoping) and frontend (widget components). Follow the existing patterns from `backend/tests/pipelines/` and `backend/tests/schema_catalog/`.

### Backend tests — `backend/tests/dashboard/`

#### `conftest.py`

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from app.core.database import Base, get_db
from app.main import app
from app.models.connection import DBConnection
from app.models.audit import AuditLog
from app.models.mapping import Mapping
from app.models.user import User
from app.services.auth_service import AuthService

@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()

@pytest.fixture
def client(db):
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()

@pytest.fixture
def admin_user(db):
    user = User(
        email="admin@test.com",
        hashed_password=AuthService.hash_password("test"),
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    return user

@pytest.fixture
def viewer_user(db):
    user = User(
        email="viewer@test.com",
        hashed_password=AuthService.hash_password("test"),
        role="viewer",
        is_active=True,
    )
    db.add(user)
    db.commit()
    return user

@pytest.fixture
def seed_data(db):
    """Seed minimal data for dashboard tests."""
    conn = DBConnection(name="Test Source", type="postgres", config={"host": "localhost"})
    db.add(conn)
    db.commit()

    audit = AuditLog(
        event_type="connector_created",
        actor="admin@test.com",
        connection_name="Test Source",
        status="completed",
    )
    db.add(audit)
    db.commit()
    return {"connector_id": conn.id, "audit_id": audit.id}
```

#### `test_aggregation_api.py`

```python
class TestDashboardSummary:
    """Tests for GET /api/v1/dashboard/summary"""

    def test_returns_200_with_valid_range(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary?range=7d")
        assert resp.status_code == 200
        data = resp.json()
        assert "kpis" in data
        assert "feed" in data
        assert data["range"] == "7d"

    def test_returns_all_kpi_tiles(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        # Expect ~8 KPI tiles (connectors, mappings, pipelines running/failed,
        # queries, security alerts, drift events, autopilot actions)
        assert len(resp.json()["kpis"]) >= 6

    def test_invalid_range_returns_422(self, client):
        resp = client.get("/api/v1/dashboard/summary?range=invalid")
        assert resp.status_code == 422

    def test_empty_system_returns_zero_counts(self, client):
        resp = client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        for kpi in resp.json()["kpis"]:
            if kpi["status"] == "loaded":
                assert kpi["value"] >= 0

    def test_each_kpi_tile_has_required_fields(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary")
        for kpi in resp.json()["kpis"]:
            assert "label" in kpi
            assert "value" in kpi
            assert "status" in kpi
            assert kpi["status"] in ("loaded", "error", "unavailable")
            assert "link_url" in kpi

    def test_feed_is_reverse_chronological(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary")
        feed = resp.json()["feed"]
        if len(feed) > 1:
            timestamps = [item["created_at"] for item in feed]
            assert timestamps == sorted(timestamps, reverse=True)

    def test_feed_item_has_required_fields(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary")
        for item in resp.json()["feed"]:
            assert "id" in item
            assert "event_type" in item
            assert "actor" in item
            assert "summary" in item
            assert "created_at" in item
```

#### `test_role_scoping.py`

```python
class TestDashboardRoleScoping:
    """Tests for role-based filtering on dashboard data."""

    def _auth_header(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    def test_admin_sees_all_tiles(self, client, admin_user, seed_data):
        # Login as admin
        login_resp = client.post("/api/v1/auth/login", json={
            "email": "admin@test.com", "password": "test"
        })
        token = login_resp.json()["access_token"]
        resp = client.get("/api/v1/dashboard/summary", headers=self._auth_header(token))
        tiles = resp.json()["kpis"]
        # Admin sees all tiles with loaded status
        assert all(t["status"] in ("loaded", "error") for t in tiles)

    def test_viewer_sees_restricted_tiles(self, client, viewer_user, seed_data):
        login_resp = client.post("/api/v1/auth/login", json={
            "email": "viewer@test.com", "password": "test"
        })
        token = login_resp.json()["access_token"]
        resp = client.get("/api/v1/dashboard/summary", headers=self._auth_header(token))
        tiles = resp.json()["kpis"]
        # Viewer sees some unavailable tiles (security, autopilot, audit)
        unavailable = [t for t in tiles if t["status"] == "unavailable"]
        assert len(unavailable) >= 1  # at least one restricted module

    def test_anonymous_user_defaults_to_viewer(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary")
        tiles = resp.json()["kpis"]
        # Anonymous sees at least one restricted tile
        unavailable = [t for t in tiles if t["status"] == "unavailable"]
        assert len(unavailable) >= 1
```

#### `test_caching.py`

```python
import time
from unittest.mock import patch

class TestDashboardCaching:
    """Tests for the dashboard caching layer."""

    def test_first_request_is_cache_miss(self, client, seed_data):
        with patch("app.services.dashboard_service.DashboardService._do_get_summary") as mock:
            mock.return_value = {"kpis": [], "feed": [], "range": "7d", "generated_at": "now"}
            resp1 = client.get("/api/v1/dashboard/summary")
            assert resp1.status_code == 200
            mock.assert_called_once()

    def test_second_request_is_cache_hit(self, client, seed_data):
        with patch("app.services.dashboard_service.DashboardService._do_get_summary") as mock:
            mock.return_value = {"kpis": [], "feed": [], "range": "7d", "generated_at": "now"}
            client.get("/api/v1/dashboard/summary")
            client.get("/api/v1/dashboard/summary")
            # _do_get_summary should only be called once (second request from cache)
            mock.assert_called_once()

    def test_different_ranges_different_cache(self, client, seed_data):
        with patch("app.services.dashboard_service.DashboardService._do_get_summary") as mock:
            mock.return_value = {"kpis": [], "feed": [], "range": "24h", "generated_at": "now"}
            client.get("/api/v1/dashboard/summary?range=24h")
            client.get("/api/v1/dashboard/summary?range=7d")
            # Two different ranges = two cache misses = two calls
            assert mock.call_count == 2

    def test_cache_ttl_expiry(self, client, seed_data):
        with patch("app.services.dashboard_service.DashboardService._do_get_summary") as mock:
            mock.return_value = {"kpis": [], "feed": [], "range": "7d", "generated_at": "now"}
            with patch("app.services.dashboard_cache.get_cache") as cache_mock:
                cache = TTLCache(maxsize=256, ttl=0.1)  # 100ms TTL
                cache_mock.return_value = cache
                client.get("/api/v1/dashboard/summary")
                time.sleep(0.15)  # wait for TTL expiry
                client.get("/api/v1/dashboard/summary")
                # Two calls after TTL expiry = two cache misses
                assert mock.call_count == 2
```

### Frontend tests — component testing

For frontend components, use React Testing Library (already available in the Next.js setup):

#### `frontend/src/app/dashboard/__tests__/KPITile.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { KPITile } from "../components/KPITile";

describe("KPITile", () => {
  it("renders value and label", () => {
    render(
      <KPITile
        label="Connected Sources"
        value={5}
        icon="🔌"
        linkUrl="/dashboard/connectors"
        status="loaded"
      />
    );
    expect(screen.getByText("Connected Sources")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders error state for unavailable status", () => {
    render(
      <KPITile
        label="Security Alerts"
        value={0}
        linkUrl="/dashboard/security"
        status="unavailable"
        errorMessage="Module not available"
      />
    );
    expect(screen.getByText("Module not available")).toBeInTheDocument();
  });

  it("formats large numbers", () => {
    render(
      <KPITile
        label="Mappings"
        value={1234567}
        linkUrl="/dashboard/schema-mapper"
        status="loaded"
      />
    );
    // Should show formatted number, not raw
    expect(screen.getByText(/1\.2M|1,234,567/)).toBeInTheDocument();
  });

  it("is a link when loaded", () => {
    render(
      <KPITile
        label="Connected Sources"
        value={3}
        linkUrl="/dashboard/connectors"
        status="loaded"
      />
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/dashboard/connectors");
  });

  it("is not a link when in error state", () => {
    render(
      <KPITile
        label="Security Alerts"
        value={0}
        linkUrl="/dashboard/security"
        status="error"
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows trend indicator", () => {
    render(
      <KPITile
        label="Pipelines Failed"
        value={3}
        trend="up"
        trendLabel="Requires attention"
        linkUrl="/dashboard/pipelines"
        status="loaded"
      />
    );
    expect(screen.getByText("↑")).toBeInTheDocument();
  });
});
```

#### `frontend/src/app/dashboard/__tests__/TimeRangeFilter.test.tsx`

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeRangeFilter } from "../components/TimeRangeFilter";

describe("TimeRangeFilter", () => {
  it("renders three options", () => {
    render(<TimeRangeFilter value="7d" onChange={() => {}} />);
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });

  it("highlights the selected option", () => {
    render(<TimeRangeFilter value="7d" onChange={() => {}} />);
    const button = screen.getByText("7 days");
    expect(button).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange when clicked", () => {
    const onChange = jest.fn();
    render(<TimeRangeFilter value="7d" onChange={onChange} />);
    fireEvent.click(screen.getByText("24h"));
    expect(onChange).toHaveBeenCalledWith("24h");
  });

  it("disables buttons when disabled prop is true", () => {
    render(<TimeRangeFilter value="7d" onChange={() => {}} disabled={true} />);
    screen.getAllByRole("radio").forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
```

## Dependencies

- Tasks #1, #2, #7 (backend logic to test)
- Tasks #3, #4, #5, #6 (frontend components to test)
- Existing test infrastructure (`pytest`, `TestClient`, in-memory SQLite)

## Edge cases covered by tests

- **Empty system:** No connectors, mappings, or pipelines → all tiles show 0.
- **Invalid range:** 422 response with descriptive error.
- **Role-scoping boundaries:** Admin sees everything, viewer sees restricted modules as unavailable.
- **Cache hit/miss:** First request is cache miss, subsequent requests within TTL are cache hits.
- **Cache TTL expiry:** After TTL expires, the next request is a cache miss.
- **Different ranges, different cache entries:** 24h and 7d produce separate cache entries.
- **Error states per tile:** A tile whose module is unavailable returns `status: "unavailable"`.
- **Feed ordering:** Feed items are reverse-chronological.
- **Link behavior:** Loaded tiles are clickable links; error tiles are not.
- **Number formatting:** Large numbers are formatted with locale separators or abbreviations.

## Verify

```bash
cd backend && .venv/bin/pytest tests/dashboard/ -v --cov=app.services.dashboard_service --cov=app.api.routers.dashboard
cd frontend && npx jest --testPathPattern="__tests__" --coverage
```

- All backend tests pass (target: 20+ tests).
- All frontend component tests pass.
- Coverage ≥ 80% for dashboard-specific code.

## Risk

Low. Test patterns are well-established in this codebase (`pytest` + `TestClient` for backend, React Testing Library for frontend). The main risk is test flakiness from cache TTL timing — mitigated by using `unittest.mock.patch` to control the cache rather than real time waits.