"""Unit tests for MappingValidationService covering the type matrix."""
import pytest

from app.services.mapping_validation_service import MappingValidationService


def _edge(target, sources, transformation=None, edge_id=1):
    return {
        "id": edge_id,
        "target": target,
        "sources": sources,
        "transformation": transformation or {"kind": "direct"},
    }


def test_same_type_is_ok():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "TEXT", "nullable": True}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_int_to_bigint_is_ok():
    e = _edge(
        {"type": "BIGINT", "nullable": False},
        [{"type": "INTEGER", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_text_to_int_without_cast_is_blocking():
    e = _edge(
        {"type": "INTEGER", "nullable": False},
        [{"type": "TEXT", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_text_to_int_with_cast_is_ok():
    e = _edge(
        {"type": "INTEGER", "nullable": False},
        [{"type": "TEXT", "nullable": False}],
        {"kind": "cast", "from": "TEXT", "to": "INTEGER"},
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_int_to_text_is_lossy_warning_without_cast():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "INTEGER", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    # lossy without cast becomes blocking
    assert r["verdict"] == "blocking"


def test_int_to_text_with_cast_is_ok():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "INTEGER", "nullable": False}],
        {"kind": "cast", "from": "INTEGER", "to": "TEXT"},
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_float_to_int_is_blocking_without_cast():
    e = _edge(
        {"type": "INTEGER", "nullable": False},
        [{"type": "FLOAT", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_timestamp_to_date_is_blocking_without_cast():
    e = _edge(
        {"type": "DATE", "nullable": False},
        [{"type": "TIMESTAMP", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    # lossy without cast becomes blocking
    assert r["verdict"] == "blocking"


def test_target_not_null_with_nullable_source_blocks_without_default():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "TEXT", "nullable": True}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_target_not_null_with_default_coalesce_is_ok():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "TEXT", "nullable": True}],
        {"kind": "default", "value_kind": "literal", "value": "n/a"},
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_pk_target_blocks_many_to_one():
    e = _edge(
        {"type": "INTEGER", "nullable": False, "primary_key": True},
        [
            {"type": "INTEGER", "nullable": False},
            {"type": "INTEGER", "nullable": False},
        ],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_empty_sources_blocks():
    e = _edge({"type": "TEXT"}, [])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_summary_counts():
    mapping = {
        "id": 99,
        "edges": [
            _edge({"type": "TEXT"}, [{"type": "TEXT"}], edge_id=1),  # ok
            _edge({"type": "INTEGER"}, [{"type": "TEXT"}], edge_id=2),  # blocking
            _edge({"type": "BIGINT"}, [{"type": "INTEGER"}], edge_id=3),  # ok
        ],
    }
    s = MappingValidationService.validate_mapping(mapping)
    assert s["mapping_id"] == 99
    assert s["ok_count"] == 2
    assert s["blocking_count"] == 1
    assert s["warning_count"] == 0
