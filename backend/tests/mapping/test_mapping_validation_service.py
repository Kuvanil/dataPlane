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
    # Both sides nullable so the null-safety check doesn't fire — we're
    # testing pure type-family compatibility here.
    e = _edge(
        {"type": "TEXT", "nullable": True},
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
    # INT→TEXT is lossy but a common safe operation (e.g. copying a numeric
    # ID for display). It must produce `lossy_warning`, not `blocking`,
    # so the mapping can be published with a visible warning the user
    # can consciously accept (review §11.2 / FR7).
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "INTEGER", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "lossy_warning"


def test_lossy_warning_with_nullable_source_escalates_to_blocking():
    # A lossy conversion that ALSO has a null-safety issue (target NOT NULL,
    # source nullable, no null-handling transform) is genuinely blocking:
    # it would silently write NULL into a NOT NULL column after a lossy
    # conversion. The null-safety escalation only fires after the lossy
    # verdict has been set, and never downgrades.
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "INTEGER", "nullable": True}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_incompatible_without_cast_still_blocks():
    # Review §11.2 explicitly: TEXT→INTEGER is *incompatible* (not lossy),
    # so it stays blocking even after the lossy_warning fix. Companion
    # to test_int_to_text_is_lossy_warning_without_cast above.
    e = _edge(
        {"type": "INTEGER", "nullable": False},
        [{"type": "TEXT", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_int_to_text_with_cast_is_ok():
    e = _edge(
        {"type": "TEXT", "nullable": False},
        [{"type": "INTEGER", "nullable": False}],
        {"kind": "cast", "from": "INTEGER", "to": "TEXT"},
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_float_to_int_is_lossy_warning_without_cast():
    # FLOAT→INTEGER is lossy (precision may be lost). It must produce
    # `lossy_warning`, not `blocking`, so the mapping can be published
    # with a visible warning. Review §11.2 / FR7.
    e = _edge(
        {"type": "INTEGER", "nullable": False},
        [{"type": "FLOAT", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "lossy_warning"


def test_timestamp_to_date_is_lossy_warning_without_cast():
    # TIMESTAMP→DATE is lossy (time-of-day information is dropped). It must
    # produce `lossy_warning`, not `blocking`. Review §11.2 / FR7.
    e = _edge(
        {"type": "DATE", "nullable": False},
        [{"type": "TIMESTAMP", "nullable": False}],
    )
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "lossy_warning"


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
