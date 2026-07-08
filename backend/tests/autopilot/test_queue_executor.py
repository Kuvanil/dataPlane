"""ai_autopilot_tasks #6: approval queue decisions + bounded executor."""
import pytest

from app.models.audit import AuditLog
from app.models.autopilot import (
    AutopilotActionLog,
    AutopilotRecommendation,
    AutopilotRun,
)
from app.services.autopilot_service import AutopilotService


@pytest.fixture(autouse=True)
def _no_celery_dispatch(monkeypatch):
    """approve() dispatches the executor task; tests run the sync core
    themselves, so neutralize the dispatch and record it."""
    from app.tasks import autopilot_tasks

    calls = []
    monkeypatch.setattr(
        autopilot_tasks.execute_recommendation_task, "delay",
        lambda **kw: calls.append(kw),
    )
    yield calls


def test_approve_transitions_and_dispatches(
    db, client_admin, pending_health_rec, _no_celery_dispatch,
):
    r = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/approve",
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    assert r.json()["decision_mode"] == "human"
    assert _no_celery_dispatch == [
        {"recommendation_id": pending_health_rec.id, "auto": False},
    ]
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "autopilot_recommendation_approved")
        .first()
    )
    assert audit is not None


def test_double_approve_409(client_admin, pending_health_rec):
    first = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/approve",
    )
    assert first.status_code == 200
    second = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/approve",
    )
    assert second.status_code == 409


def test_approve_requires_admin(client_analyst, pending_health_rec):
    r = client_analyst.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/approve",
    )
    assert r.status_code == 403


def test_reject_never_executes(db, client_admin, pending_health_rec,
                               _no_celery_dispatch):
    r = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/reject",
        json={"reason": "not now"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert _no_celery_dispatch == []
    # Executor on a rejected rec is a no-op (guarded transition).
    out = AutopilotService.execute_recommendation(
        db, pending_health_rec.id, auto=False,
    )
    assert out["status"] == "skipped"
    assert db.query(AutopilotActionLog).count() == 0


def test_modify_validates_and_stores(db, client_admin, pending_health_rec, two_conns):
    _, tgt = two_conns
    bad = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/modify",
        json={"payload": {"connection_id": "not-an-int"}},
    )
    assert bad.status_code == 422

    good = client_admin.post(
        f"/api/v1/autopilot/recommendations/{pending_health_rec.id}/modify",
        json={"payload": {"connection_id": tgt.id}},
    )
    assert good.status_code == 200
    assert good.json()["payload"] == {"connection_id": tgt.id}
    assert good.json()["modified_by"] == "admin@test.local"
    assert good.json()["status"] == "pending"


def test_executor_happy_path_health_check(db, pending_health_rec):
    """Approved connector_health_check runs the real probe against the live
    sqlite file and records outcome + reversibility."""
    AutopilotService.approve(db, pending_health_rec.id, actor="admin@test.local")
    out = AutopilotService.execute_recommendation(
        db, pending_health_rec.id, auto=False,
    )
    assert out["status"] == "executed"
    db.refresh(pending_health_rec)
    assert pending_health_rec.status == "executed"
    assert pending_health_rec.execution_result["success"] is True
    log = db.query(AutopilotActionLog).one()
    assert log.mode == "approved"
    assert log.outcome == "success"
    assert log.reversibility_note
    assert log.recommendation_id == pending_health_rec.id
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "autopilot_action_executed")
        .first()
    )
    assert audit is not None


def test_executor_is_idempotent(db, pending_health_rec):
    AutopilotService.approve(db, pending_health_rec.id, actor="admin@test.local")
    first = AutopilotService.execute_recommendation(
        db, pending_health_rec.id, auto=False,
    )
    second = AutopilotService.execute_recommendation(
        db, pending_health_rec.id, auto=False,
    )
    assert first["status"] == "executed"
    assert second["status"] == "skipped"
    assert db.query(AutopilotActionLog).count() == 1


def test_executor_failure_is_clean(db, two_conns):
    """Executing against a deleted connection fails the rec, never crashes."""
    src, _ = two_conns
    rec, _ = AutopilotService.upsert_recommendation(
        db, action_type="connector_health_check",
        subject=f"connection:{src.id}", payload={"connection_id": src.id},
        rationale={"summary": "s", "evidence": [], "trigger": {}},
        confidence=90.0, created_by="autopilot-engine",
    )
    db.commit()
    src.is_deleted = True
    db.commit()
    AutopilotService.approve(db, rec.id, actor="admin@test.local")
    out = AutopilotService.execute_recommendation(db, rec.id, auto=False)
    assert out["status"] == "failed"
    db.refresh(rec)
    assert rec.status == "failed"
    log = db.query(AutopilotActionLog).one()
    assert log.outcome == "failure"
    assert "not found or deleted" in log.detail["error"]


def test_migration_execute_creates_run_and_dispatches(db, client_admin, two_conns,
                                                      monkeypatch):
    """Approving the legacy execute-mode rec starts the legacy run task."""
    from app.tasks import ai_tasks

    dispatched = {}
    monkeypatch.setattr(
        ai_tasks.run_autopilot_task, "delay", lambda **kw: dispatched.update(kw),
    )
    src, tgt = two_conns
    queued = client_admin.post(
        "/api/v1/autopilot/run",
        json={"source_id": src.id, "target_id": tgt.id, "mode": "execute"},
    )
    rec_id = queued.json()["recommendation_id"]

    AutopilotService.approve(db, rec_id, actor="admin@test.local")
    out = AutopilotService.execute_recommendation(db, rec_id, auto=False)
    assert out["status"] == "executed"
    assert dispatched["mode"] == "execute"
    run = db.query(AutopilotRun).filter(AutopilotRun.id == dispatched["run_id"]).one()
    assert run.mode == "execute"


def test_list_recommendations_filters(client_admin, pending_health_rec):
    r = client_admin.get("/api/v1/autopilot/recommendations?status=pending")
    assert r.status_code == 200
    assert r.json()["total"] == 1
    r_all = client_admin.get("/api/v1/autopilot/recommendations?status=all")
    assert r_all.json()["total"] == 1
    r_none = client_admin.get("/api/v1/autopilot/recommendations?status=executed")
    assert r_none.json()["total"] == 0
