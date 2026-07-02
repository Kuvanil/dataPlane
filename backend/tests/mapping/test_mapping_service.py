"""Unit tests for MappingService state machine + audit emission."""
import pytest
from fastapi import HTTPException

from app.models.audit import AuditLog
from app.models.mapping import FieldMapping
from app.services import schema_service
from app.services.mapping_service import MappingService


def _fake_schema(_conn):
    return {
        "t1": [{"name": "c1", "type": "TEXT"}],
        "t2": [{"name": "c2", "type": "TEXT"}],
    }


def test_create_mapping_writes_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="My Mapping", actor=admin.email,
    )
    assert m.id is not None
    assert m.status == "draft"
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_created")
        .first()
    )
    assert audit is not None
    assert audit.payload["mapping_id"] == m.id


def test_create_mapping_rejects_same_source_target(db, admin, seeded_connections):
    src, _ = seeded_connections
    with pytest.raises(HTTPException):
        MappingService.create_mapping(
            db, source_id=src.id, target_id=src.id,
            name="Bad", actor=admin.email,
        )


def test_create_mapping_rejects_unknown_connection(db, admin):
    with pytest.raises(HTTPException) as e:
        MappingService.create_mapping(
            db, source_id=9999, target_id=9998,
            name="X", actor=admin.email,
        )
    assert e.value.status_code == 404


def test_add_edge_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    assert edge.id is not None
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_edge_added")
        .first()
    )
    assert audit is not None


def test_add_edge_blocks_many_to_many(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t2", "column": "c2", "type": "TEXT"},
            sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
            transformation={"kind": "direct"},
            actor=admin.email,
        )
    assert e.value.status_code == 409


def test_add_edge_rejects_bad_transformation(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT"},
            sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
            transformation={"kind": "evil_eval"},
            actor=admin.email,
        )
    assert e.value.status_code == 422


def test_add_edge_rejects_empty_sources(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT"},
            sources=[],
            transformation={"kind": "direct"},
            actor=admin.email,
        )
    assert e.value.status_code == 422


def test_remove_edge_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    MappingService.remove_edge(db, m.id, edge.id, actor=admin.email)
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_edge_removed")
        .first()
    )
    assert audit is not None


def test_update_edge_transformation_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    MappingService.update_edge_transformation(
        db, m.id, edge.id,
        {"kind": "upper"},
        actor=admin.email,
    )
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_edge_updated")
        .first()
    )
    assert audit is not None


def test_publish_blocks_when_validation_blocking(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    # Text -> Integer without cast = blocking
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "INTEGER"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.publish(db, m.id, actor=admin.email)
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "validation_blocking"


def test_publish_creates_immutable_version(db, admin, seeded_connections, monkeypatch):
    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v = MappingService.publish(db, m.id, actor=admin.email)
    assert v.version_number == 1
    assert v.status == "published"
    db.refresh(m)
    assert m.status == "published"
    assert m.current_version_id == v.id
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_published")
        .first()
    )
    assert audit is not None
    assert audit.payload["version_number"] == 1


def test_publish_second_version_increments(db, admin, seeded_connections, monkeypatch):
    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v1 = MappingService.publish(db, m.id, actor=admin.email)
    db.refresh(m)
    m.status = "draft"
    db.commit()
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c2", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c2", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v2 = MappingService.publish(db, m.id, actor=admin.email)
    assert v2.version_number == 2


def test_publish_cannot_be_republished(db, admin, seeded_connections, monkeypatch):
    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    MappingService.publish(db, m.id, actor=admin.email)
    db.refresh(m)
    with pytest.raises(HTTPException) as e:
        MappingService.publish(db, m.id, actor=admin.email)
    assert e.value.status_code == 409


def test_export_json_shape(db, admin, seeded_connections, monkeypatch):
    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="ExportTest", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v = MappingService.publish(db, m.id, actor=admin.email)
    artifact = MappingService.export_json(db, m.id, actor=admin.email)
    assert artifact["mapping_id"] == m.id
    assert artifact["version"] == v.version_number
    assert "field_mappings" in artifact and len(artifact["field_mappings"]) == 1
    assert "schema_snapshot" in artifact
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_exported")
        .first()
    )
    assert audit is not None


def test_export_json_fails_without_published_version(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="NoVer", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.export_json(db, m.id, actor=admin.email)
    assert e.value.status_code == 409


def test_delete_mapping_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.delete_mapping(db, m.id, actor=admin.email)
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_deleted")
        .first()
    )
    assert audit is not None


def test_delete_published_mapping_blocked(db, admin, seeded_connections, monkeypatch):
    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    MappingService.publish(db, m.id, actor=admin.email)
    with pytest.raises(HTTPException) as e:
        MappingService.delete_mapping(db, m.id, actor=admin.email)
    assert e.value.status_code == 409


def test_update_mapping_meta_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Original", actor=admin.email,
    )
    MappingService.update_mapping_meta(db, m.id, name="Renamed", actor=admin.email)
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_meta_updated")
        .first()
    )
    assert audit is not None


def test_validate_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    summary = MappingService.validate(db, m.id, actor=admin.email)
    assert summary["blocking_count"] == 0
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_validated")
        .first()
    )
    assert audit is not None


def test_reject_suggestion_emits_audit(db, admin, seeded_connections):
    from datetime import datetime, timezone
    from app.models.mapping import AISuggestion
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    sug = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c1", target_type="TEXT",
        source_table="s1", source_column="c1", source_type="TEXT",
        confidence=85.0, reason="test", status="pending",
    )
    db.add(sug)
    db.commit()
    db.refresh(sug)
    MappingService.reject_suggestion(db, m.id, sug.id, actor=admin.email)
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "ai_suggestion_rejected")
        .first()
    )
    assert audit is not None


def test_accept_suggestion_creates_edge_and_audit(db, admin, seeded_connections):
    from app.models.mapping import AISuggestion
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )
    sug = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c1", target_type="TEXT",
        source_table="s1", source_column="c1", source_type="TEXT",
        confidence=92.0, reason="test", status="pending",
    )
    db.add(sug)
    db.commit()
    db.refresh(sug)
    edge = MappingService.accept_suggestion(
        db, m.id, sug.id, {"kind": "direct"}, actor=admin.email,
    )
    # ai_confidence is normalized to 0.0-1.0 (contract §3).
    assert edge.ai_confidence == pytest.approx(0.92)
    assert edge.origin == "ai_accepted"
    db.refresh(sug)
    assert sug.status == "accepted"
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "ai_suggestion_accepted")
        .first()
    )
    assert audit is not None
    assert audit.payload["confidence"] == 92.0


def test_accept_suggestion_blocks_second_suggestion_with_same_source(
    db, admin, seeded_connections,
):
    """Review §11.4: suggestion acceptance cannot create many-to-many mappings.

    Creates two AISuggestion rows that both reference the same source
    column (s1.c1) for two DIFFERENT target columns (t1.c1, t1.c2).
    Accepting the first is fine. Accepting the second must be rejected
    with HTTP 409 by the shared FR3 guard — the prior implementation
    skipped the guard on the suggestion path and let N:M mappings slip
    through silently.
    """
    from app.models.mapping import AISuggestion
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="NN bypass test", actor=admin.email,
    )
    sug1 = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c1", target_type="TEXT",
        source_table="s1", source_column="c1", source_type="TEXT",
        confidence=90.0, reason="first", status="pending",
    )
    sug2 = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c2", target_type="INTEGER",
        source_table="s1", source_column="c1", source_type="TEXT",
        confidence=85.0, reason="second", status="pending",
    )
    db.add_all([sug1, sug2])
    db.commit()
    db.refresh(sug1)
    db.refresh(sug2)

    # First acceptance succeeds.
    edge1 = MappingService.accept_suggestion(
        db, m.id, sug1.id, {"kind": "direct"}, actor=admin.email,
    )
    assert edge1.target_table == "t1"
    assert edge1.target_column == "c1"

    # Second acceptance — same source column, different target column —
    # must be blocked by the shared FR3 many-to-many guard.
    with pytest.raises(HTTPException) as e:
        MappingService.accept_suggestion(
            db, m.id, sug2.id, {"kind": "direct"}, actor=admin.email,
        )
    assert e.value.status_code == 409
    assert "many-to-many" in e.value.detail.lower()

    # sug2 must remain pending — the failed accept must not have side-effects.
    db.refresh(sug2)
    assert sug2.status == "pending"


def test_check_no_many_to_many_is_independent_helper(db, admin, seeded_connections):
    """The extracted _check_no_many_to_many helper works in isolation.

    Smoke test: calling it with a non-conflicting target passes
    silently; calling it with a conflicting one raises 409.
    """
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Helper smoke", actor=admin.email,
    )
    # First edge — no conflict.
    MappingService._check_no_many_to_many(
        db, m.id,
        target={"table": "t1", "column": "c1"},
        sources=[{"table": "s1", "column": "c1"}],
    )
    # Add a real edge so there's something to conflict against.
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1"},
        sources=[{"table": "s1", "column": "c1"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    # Same source, different target — conflict.
    with pytest.raises(HTTPException) as e:
        MappingService._check_no_many_to_many(
            db, m.id,
            target={"table": "t1", "column": "c2"},
            sources=[{"table": "s1", "column": "c1"}],
        )
    assert e.value.status_code == 409
    # Same source, same target — allowed (re-mapping the same edge).
    MappingService._check_no_many_to_many(
        db, m.id,
        target={"table": "t1", "column": "c1"},
        sources=[{"table": "s1", "column": "c1"}],
    )
