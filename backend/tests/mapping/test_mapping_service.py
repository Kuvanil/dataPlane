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
    assert edge.ai_confidence == 92.0
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
