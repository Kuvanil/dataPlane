"""ai_autopilot_tasks #5: trigger evaluators, dedupe, supersede."""
from app.models.audit import AuditLog
from app.models.autopilot import AutopilotRecommendation
from app.models.drift_event import DriftEvent
from app.models.mapping import Mapping
from app.services.autopilot_engine import AutopilotEngine


def _recs(db, action_type=None, status=None):
    q = db.query(AutopilotRecommendation)
    if action_type:
        q = q.filter(AutopilotRecommendation.action_type == action_type)
    if status:
        q = q.filter(AutopilotRecommendation.status == status)
    return q.all()


def test_down_connection_creates_health_rec(db, two_conns):
    src, _ = two_conns
    src.health_status = "down"
    src.last_test_error = "connection refused"
    db.commit()

    counts = AutopilotEngine.evaluate_all(db)
    assert counts["created"] == 1
    rec = _recs(db, "connector_health_check", "pending")[0]
    assert rec.payload == {"connection_id": src.id}
    assert rec.subject == f"connection:{src.id}"
    assert "down" in rec.rationale["summary"]
    assert any("connection refused" in e for e in rec.rationale["evidence"])
    assert rec.confidence == 90.0
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "autopilot_recommendation_created")
        .first()
    )
    assert audit is not None


def test_reevaluation_refreshes_not_duplicates(db, two_conns):
    src, _ = two_conns
    src.health_status = "degraded"
    db.commit()

    first = AutopilotEngine.evaluate_all(db)
    second = AutopilotEngine.evaluate_all(db)
    assert first["created"] == 1
    assert second["created"] == 0
    assert second["refreshed"] == 1
    assert len(_recs(db, "connector_health_check")) == 1


def test_recovered_connection_supersedes_rec(db, two_conns):
    src, _ = two_conns
    src.health_status = "down"
    db.commit()
    AutopilotEngine.evaluate_all(db)

    src.health_status = "healthy"
    db.commit()
    counts = AutopilotEngine.evaluate_all(db)
    assert counts["superseded"] == 1
    rec = _recs(db, "connector_health_check")[0]
    assert rec.status == "superseded"
    assert "healthy again" in (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "autopilot_recommendation_superseded")
        .first()
        .payload["reason"]
    )


def test_drift_on_draft_mapping_creates_refresh_rec(db, two_conns):
    src, tgt = two_conns
    m = Mapping(name="Drafty", source_id=src.id, target_id=tgt.id, status="draft")
    db.add(m)
    db.flush()
    db.add(DriftEvent(
        connection_id=src.id, snapshot_id=_snapshot(db, src.id),
        tables_added=["new_table"], tables_removed=[],
        columns_added=[{"table": "t", "column": "c"}], columns_removed=[],
        type_changes=[],
    ))
    db.commit()

    counts = AutopilotEngine.evaluate_all(db)
    assert counts["created"] == 1
    rec = _recs(db, "mapping_suggestions_refresh", "pending")[0]
    assert rec.payload == {"mapping_id": m.id}
    assert rec.confidence == 80.0  # additions present
    assert "Drafty" in rec.rationale["summary"]
    assert rec.rationale["trigger"]["kind"] == "schema_drift"


def test_drift_ignores_published_mappings(db, two_conns):
    src, tgt = two_conns
    db.add(Mapping(name="Pub", source_id=src.id, target_id=tgt.id, status="published"))
    db.flush()
    db.add(DriftEvent(
        connection_id=src.id, snapshot_id=_snapshot(db, src.id),
        tables_added=["x"], tables_removed=[], columns_added=[],
        columns_removed=[], type_changes=[],
    ))
    db.commit()

    counts = AutopilotEngine.evaluate_all(db)
    assert counts["created"] == 0
    assert _recs(db, "mapping_suggestions_refresh") == []


def test_publishing_mapping_supersedes_open_refresh_rec(db, two_conns):
    src, tgt = two_conns
    m = Mapping(name="Drafty2", source_id=src.id, target_id=tgt.id, status="draft")
    db.add(m)
    db.flush()
    db.add(DriftEvent(
        connection_id=src.id, snapshot_id=_snapshot(db, src.id),
        tables_added=["x"], tables_removed=[], columns_added=[],
        columns_removed=[], type_changes=[],
    ))
    db.commit()
    AutopilotEngine.evaluate_all(db)
    assert len(_recs(db, "mapping_suggestions_refresh", "pending")) == 1

    m.status = "published"
    db.commit()
    counts = AutopilotEngine.evaluate_all(db)
    assert counts["superseded"] == 1
    assert _recs(db, "mapping_suggestions_refresh")[0].status == "superseded"


def _snapshot(db, connection_id: int) -> int:
    """DriftEvent.snapshot_id is NOT NULL — create a minimal snapshot row."""
    from app.models.schema_snapshot import SchemaSnapshot
    snap = SchemaSnapshot(
        connection_id=connection_id, connection_name=f"conn-{connection_id}",
        schema_hash="h", schema_json={},
    )
    db.add(snap)
    db.flush()
    return snap.id
