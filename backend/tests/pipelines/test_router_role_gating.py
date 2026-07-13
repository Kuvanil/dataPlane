"""Role-gating + audit tests for the Pipelines router (Task #8),
covering the endpoints added by Tasks #3-#6 and #9: run, rerun,
schedule CRUD, retry-policy upsert.

Mirrors the TestClient pattern in tests/mapping/test_mappings_router.py.
Celery dispatch is stubbed (run_pipeline_task.delay) so these tests
exercise only the router/service layer, not the execution engine —
that's covered by test_execution_engine.py.
"""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.core.scheduler as scheduler_module
from app.api.routers.auth import get_current_user
from app.core import database as db_module
from app.main import app
from app.workers import pipeline_tasks as pipeline_tasks_module


class _NoCloseSession:
    """Proxy that hands the scheduler the test session but ignores close()."""

    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        if name == "close":
            return lambda: None
        return getattr(self._s, name)


@pytest.fixture(autouse=True)
def stub_celery_dispatch(monkeypatch, db):
    monkeypatch.setattr(
        pipeline_tasks_module.run_pipeline_task, "delay",
        lambda *a, **kw: SimpleNamespace(id="fake-task-id"),
    )
    # The router's schedule endpoints call app.core.scheduler.sync_schedule,
    # which opens its own SessionLocal() — point it at the test's db so it
    # sees the same in-memory database the TestClient requests write to.
    monkeypatch.setattr(scheduler_module, "SessionLocal", lambda: _NoCloseSession(db))


def _client_for(db, user):
    def _override_user():
        return user

    def _override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[db_module.get_db] = _override_db
    return TestClient(app)


@pytest.fixture()
def client_admin(db, admin):
    c = _client_for(db, admin)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def client_analyst(db, analyst):
    c = _client_for(db, analyst)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def client_viewer(db, viewer):
    c = _client_for(db, viewer)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


def _make_pipeline(db, admin, seeded_connections, seeded_published_mapping):
    from app.services.pipeline_service import PipelineCRUD
    src, tgt = seeded_connections
    mapping, _ = seeded_published_mapping
    return PipelineCRUD.create_pipeline(
        db, name="RouterTest", source_connection_id=src.id,
        target_connection_id=tgt.id, mapping_id=mapping.id, actor=admin.email,
    )


def test_viewer_cannot_run_pipeline(db, admin, client_viewer, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_viewer.post(f"/api/v1/pipelines/{p.id}/run")
    assert resp.status_code == 403


def test_analyst_can_run_pipeline(db, admin, client_analyst, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_analyst.post(f"/api/v1/pipelines/{p.id}/run")
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["task_id"] == "fake-task-id"


def test_second_concurrent_run_returns_409(db, admin, client_analyst, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    first = client_analyst.post(f"/api/v1/pipelines/{p.id}/run")
    assert first.status_code == 202
    second = client_analyst.post(f"/api/v1/pipelines/{p.id}/run")
    assert second.status_code == 409


def test_viewer_cannot_schedule_pipeline(db, admin, client_viewer, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_viewer.put(
        f"/api/v1/pipelines/{p.id}/schedule",
        json={"cron_expression": "0 2 * * *", "enabled": True, "timezone": "UTC"},
    )
    assert resp.status_code == 403


def test_analyst_can_schedule_pipeline(db, admin, client_analyst, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_analyst.put(
        f"/api/v1/pipelines/{p.id}/schedule",
        json={"cron_expression": "0 2 * * *", "enabled": True, "timezone": "UTC"},
    )
    assert resp.status_code == 200
    assert resp.json()["cron_expression"] == "0 2 * * *"


def test_invalid_cron_returns_422(db, admin, client_analyst, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_analyst.put(
        f"/api/v1/pipelines/{p.id}/schedule",
        json={"cron_expression": "not a cron", "enabled": True, "timezone": "UTC"},
    )
    assert resp.status_code == 422


def test_analyst_can_update_retry_policy(db, admin, client_analyst, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_analyst.put(
        f"/api/v1/pipelines/{p.id}/retry-policy",
        json={"max_attempts": 5, "backoff_seconds": 30},
    )
    assert resp.status_code == 200
    assert resp.json()["max_attempts"] == 5


def test_viewer_cannot_delete_pipeline_but_analyst_also_cannot(
    db, admin, analyst, viewer, seeded_connections, seeded_published_mapping,
):
    """Two identities exercised against a single shared TestClient — see
    test_rerun_requires_analyst_or_admin for why two separate client_*
    fixtures can't be used together here."""
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)

    def _override_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[db_module.get_db] = _override_db

    client = TestClient(app)
    try:
        app.dependency_overrides[get_current_user] = lambda: viewer
        assert client.delete(f"/api/v1/pipelines/{p.id}").status_code == 403

        app.dependency_overrides[get_current_user] = lambda: analyst
        assert client.delete(f"/api/v1/pipelines/{p.id}").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_admin_can_delete_pipeline(db, admin, client_admin, seeded_connections, seeded_published_mapping):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    resp = client_admin.delete(f"/api/v1/pipelines/{p.id}")
    assert resp.status_code == 204


def test_rerun_requires_analyst_or_admin(db, admin, analyst, viewer, seeded_connections, seeded_published_mapping):
    """A single shared TestClient, switching the active user via
    app.dependency_overrides before each call — using two separately-built
    client_* fixtures in one test would race on that same global override
    (whichever fixture is set up last wins for every request)."""
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)

    def _as(user):
        app.dependency_overrides[get_current_user] = lambda: user

    def _override_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[db_module.get_db] = _override_db

    client = TestClient(app)
    try:
        _as(analyst)
        run_resp = client.post(f"/api/v1/pipelines/{p.id}/run")
        run_id = run_resp.json()["run_id"]

        # Mark the run finished so rerun's concurrency guard doesn't 409 it.
        from app.models.pipeline import PipelineRun
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        run.status = "succeeded"
        db.commit()

        _as(viewer)
        assert client.post(f"/api/v1/pipelines/{p.id}/runs/{run_id}/rerun").status_code == 403

        _as(analyst)
        rerun_resp = client.post(f"/api/v1/pipelines/{p.id}/runs/{run_id}/rerun")
        assert rerun_resp.status_code == 202
        assert rerun_resp.json()["original_run_id"] == run_id
    finally:
        app.dependency_overrides.clear()


def test_get_pipeline_includes_schedule_and_retry_policy(
    db, admin, client_admin, seeded_connections, seeded_published_mapping,
):
    p = _make_pipeline(db, admin, seeded_connections, seeded_published_mapping)
    client_admin.put(
        f"/api/v1/pipelines/{p.id}/schedule",
        json={"cron_expression": "0 3 * * *", "enabled": True, "timezone": "UTC"},
    )
    resp = client_admin.get(f"/api/v1/pipelines/{p.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["schedule"]["cron_expression"] == "0 3 * * *"
    assert body["retry_policy"]["max_attempts"] == 3  # default from create_pipeline
