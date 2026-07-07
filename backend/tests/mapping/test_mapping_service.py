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


def test_add_edge_blocks_multi_source_with_direct_kind(db, admin, seeded_connections):
    """Mapper_tasks #1: >1 sources with a kind that emits a single placeholder
    must be blocked at add_edge time, not at Pipelines-execution time."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="NN Direct", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
            sources=[
                {"table": "s1", "column": "c1", "type": "TEXT", "nullable": False},
                {"table": "s1", "column": "c2", "type": "TEXT", "nullable": False},
            ],
            transformation={"kind": "direct"},
            actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"
    assert "does not support 2 source columns" in e.value.detail["message"]


def test_add_edge_allows_multi_source_with_concat_kind(db, admin, seeded_connections):
    """Counterpart to the negative case: concat is the only kind that
    iterates sources explicitly (see transformation_grammar._sql_concat),
    so multi-source + concat must still be accepted."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat OK", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[
            {"table": "s1", "column": "c1", "type": "TEXT", "nullable": False},
            {"table": "s1", "column": "c2", "type": "TEXT", "nullable": False},
        ],
        transformation={
            "kind": "concat",
            "parts": [
                {"kind": "source"},
                {"kind": "literal", "value": " "},
                {"kind": "source"},
            ],
        },
        actor=admin.email,
    )
    assert edge.id is not None
    assert len(edge.sources) == 2


def test_add_edge_allows_single_source_with_concat_kind(db, admin, seeded_connections):
    """1-source edges with concat must also be accepted (no regression)."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat Single", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "concat", "parts": [{"kind": "source"}]},
        actor=admin.email,
    )
    assert edge.id is not None


def test_add_edge_blocks_single_source_concat_with_no_source_part(db, admin, seeded_connections):
    """Round-2 review #4: a concat whose parts consume FEWER sources than the
    edge binds silently drops a source column at SQL-compile time. The exact
    parts-count check must apply to single-source edges too, not hide behind
    the multi-source early return."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat Underconsume", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
            sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
            # All-literal parts: 0 'source' parts against 1 bound source.
            transformation={
                "kind": "concat",
                "parts": [{"kind": "literal", "value": "static"}],
            },
            actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"
    assert "0 'source' part(s)" in e.value.detail["message"]


def test_update_edge_transformation_blocks_single_source_concat_underconsumption(
    db, admin, seeded_connections,
):
    """Same defect class via the edit-after-create path: editing a 1-source
    edge's transformation to an all-literal concat must be rejected."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat Underconsume Update", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.update_edge_transformation(
            db, m.id, edge.id,
            {"kind": "concat", "parts": [{"kind": "literal", "value": "x"}]},
            actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"


def test_update_edge_transformation_blocks_multi_source_non_concat(db, admin, seeded_connections):
    """Changing the transformation on an already-multi-source edge must also
    be blocked if the new kind can't handle >1 sources."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Update NN", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[
            {"table": "s1", "column": "c1", "type": "TEXT", "nullable": False},
            {"table": "s1", "column": "c2", "type": "TEXT", "nullable": False},
        ],
        transformation={
            "kind": "concat",
            "parts": [{"kind": "source"}, {"kind": "source"}],
        },
        actor=admin.email,
    )
    # Trying to change the transformation on a multi-source edge to a
    # kind that only handles one source must be rejected.
    with pytest.raises(HTTPException) as e:
        MappingService.update_edge_transformation(
            db, m.id, edge.id, {"kind": "direct"}, actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"


def test_add_edge_rejects_concat_with_fewer_source_parts_than_sources(db, admin, seeded_connections):
    """Completeness review of mapper_tasks #1: the multi-source guard must
    also reject a concat whose 'source' parts under-count the edge's actual
    sources, not just a non-concat kind. Under-consumption previously
    compiled silently (only over-consumption raised in _sql_concat)."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat Undercount", actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
            sources=[
                {"table": "s1", "column": "c1", "type": "TEXT", "nullable": False},
                {"table": "s1", "column": "c2", "type": "TEXT", "nullable": False},
            ],
            transformation={"kind": "concat", "parts": [{"kind": "source"}]},
            actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"
    assert "concat.parts" in e.value.detail["location"]


def test_update_edge_transformation_rejects_concat_part_count_mismatch(db, admin, seeded_connections):
    """Same under-consumption guard, exercised via update_edge_transformation
    (e.g. TransformEditor changing an existing multi-source edge's parts)."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Concat Undercount Update", actor=admin.email,
    )
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[
            {"table": "s1", "column": "c1", "type": "TEXT", "nullable": False},
            {"table": "s1", "column": "c2", "type": "TEXT", "nullable": False},
        ],
        transformation={"kind": "concat", "parts": [{"kind": "source"}, {"kind": "source"}]},
        actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.update_edge_transformation(
            db, m.id, edge.id,
            {"kind": "concat", "parts": [{"kind": "source"}]},
            actor=admin.email,
        )
    assert e.value.status_code == 422
    assert e.value.detail["kind"] == "grammar_error"


def test_add_edge_rejects_second_edge_to_already_mapped_target(db, admin, seeded_connections):
    """Completeness review of mapper_tasks #1: N:1 is one edge with many
    sources, not two competing edges to the same target column -- the
    latter is ambiguous at Pipelines-execution time and was previously
    unguarded (only source-side reuse was checked, never target-side)."""
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Target Collision", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
            sources=[{"table": "s1", "column": "c2", "type": "TEXT", "nullable": False}],
            transformation={"kind": "direct"},
            actor=admin.email,
        )
    assert e.value.status_code == 409
    assert "already mapped" in e.value.detail.lower()


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


def test_publish_race_condition_returns_409(db, admin, seeded_connections, monkeypatch):
    """CONTRADICTIONS.md C5: two concurrent publishes racing on version_number
    must surface as a clean 409, not an unhandled IntegrityError/500.

    Simulated by inserting a competing mapping_versions row (version_number=1
    for this mapping) directly on the session's underlying connection -- Core
    execute(), not the ORM -- right as this session's own flush() runs. That
    reproduces exactly the collision two concurrent publish() calls would hit
    on the DB's UniqueConstraint(mapping_id, version_number), without needing
    a second real connection/thread.
    """
    from sqlalchemy import text

    from app.models.mapping import MappingVersion as _MappingVersion

    monkeypatch.setattr(
        schema_service.SchemaService, "get_full_schema",
        staticmethod(_fake_schema),
    )
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Race", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )

    real_flush = db.flush
    state = {"done": False}

    def _flush_with_concurrent_interloper(*args, **kwargs):
        # SQLAlchemy autoflushes on every query, including publish()'s own
        # "last version" lookup -- that fires this wrapper too, before
        # next_n has even been decided. Only inject the interloper once the
        # ORM actually has a pending MappingVersion to insert (i.e. we're at
        # publish()'s own `db.add(version); db.flush()`), so next_n=1 has
        # already been locked in and the collision is genuine.
        pending_version = any(isinstance(o, _MappingVersion) for o in db.new)
        if not state["done"] and pending_version:
            state["done"] = True
            # Raw Core execute on the session's own connection -- bypasses
            # the ORM identity map/autoflush so it doesn't recurse back into
            # this patched flush(), while still landing in the same
            # transaction the way a concurrent request's own commit would
            # have landed in the DB before this one gets there.
            db.connection().execute(
                text(
                    "INSERT INTO mapping_versions "
                    "(mapping_id, version_number, status, published_by) "
                    "VALUES (:mid, 1, 'published', 'other-admin@test.local')"
                ),
                {"mid": m.id},
            )
        return real_flush(*args, **kwargs)

    monkeypatch.setattr(db, "flush", _flush_with_concurrent_interloper)

    with pytest.raises(HTTPException) as e:
        MappingService.publish(db, m.id, actor=admin.email)
    assert e.value.status_code == 409

    # The mapping must remain a publishable draft -- the failed attempt must
    # not have left it half-published.
    db.rollback()
    db.refresh(m)
    assert m.status == "draft"


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


def test_accept_suggestion_blocks_already_mapped_target(db, admin, seeded_connections):
    """Round-2 review #3: the double-mapped-target guard must apply to the
    suggestion path too. Map t1.c1 manually, then accept an AI suggestion for
    the same target — two edges to one target is ambiguous at
    Pipelines-execution time regardless of which path created the second."""
    from app.models.mapping import AISuggestion
    src, tgt = seeded_connections
    m = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="Target dup via suggestion", actor=admin.email,
    )
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    sug = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c1", target_type="TEXT",
        source_table="s1", source_column="c2", source_type="TEXT",
        confidence=88.0, reason="dup target", status="pending",
    )
    db.add(sug)
    db.commit()
    db.refresh(sug)

    with pytest.raises(HTTPException) as e:
        MappingService.accept_suggestion(
            db, m.id, sug.id, {"kind": "direct"}, actor=admin.email,
        )
    assert e.value.status_code == 409
    assert "already mapped" in e.value.detail.lower()

    # The failed accept must leave the suggestion pending.
    db.refresh(sug)
    assert sug.status == "pending"


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


# ── Suggestion lifecycle at publish time ─────────────────────────────────


def test_publish_supersedes_pending_suggestions(
    db, admin, seeded_connections, monkeypatch,
):
    """Publish is terminal for the draft, so pending suggestions can never
    be accepted afterwards (only draft mappings are mutable). Publish must
    close them out as 'superseded' instead of leaving un-actionable
    'pending' rows behind, and must leave already-decided rows untouched.
    """
    from app.models.mapping import AISuggestion
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
    pending = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c2", target_type="TEXT",
        source_table="s1", source_column="c2", source_type="TEXT",
        confidence=88.0, reason="test", status="pending",
    )
    rejected = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c3", target_type="TEXT",
        source_table="s1", source_column="c3", source_type="TEXT",
        confidence=70.0, reason="test", status="rejected",
    )
    db.add_all([pending, rejected])
    db.commit()

    MappingService.publish(db, m.id, actor=admin.email)

    db.refresh(pending)
    db.refresh(rejected)
    assert pending.status == "superseded"
    assert pending.decided_by == admin.email
    assert pending.decided_at is not None
    assert rejected.status == "rejected"  # decided rows untouched

    audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "mapping_published")
        .first()
    )
    assert audit.payload["suggestions_superseded"] == 1


def test_superseded_suggestion_cannot_be_accepted_or_rejected(
    db, admin, seeded_connections, monkeypatch,
):
    from app.models.mapping import AISuggestion
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
    sug = AISuggestion(
        mapping_id=m.id,
        target_table="t1", target_column="c2", target_type="TEXT",
        source_table="s1", source_column="c2", source_type="TEXT",
        confidence=88.0, reason="test", status="pending",
    )
    db.add(sug)
    db.commit()
    MappingService.publish(db, m.id, actor=admin.email)

    # Accept hits the draft guard first (mapping is published) — 409.
    with pytest.raises(HTTPException) as e:
        MappingService.accept_suggestion(
            db, m.id, sug.id, {"kind": "direct"}, actor=admin.email,
        )
    assert e.value.status_code == 409
    # Reject has no draft guard but the suggestion is no longer pending — 409.
    with pytest.raises(HTTPException) as e:
        MappingService.reject_suggestion(db, m.id, sug.id, actor=admin.email)
    assert e.value.status_code == 409
    assert "superseded" in str(e.value.detail)
