"""Unit tests for the restricted transformation grammar."""
import pytest

from app.services.transformation_grammar import (
    GrammarError, compile_sql, parse,
)


def test_direct_accepts_empty_payload():
    ast = parse({"kind": "direct"})
    assert ast["kind"] == "direct"


def test_unknown_kind_rejected():
    with pytest.raises(GrammarError) as e:
        parse({"kind": "evil_eval"})
    assert e.value.kind == "unknown_kind"


def test_payload_must_be_object():
    with pytest.raises(GrammarError):
        parse("not an object")
    with pytest.raises(GrammarError):
        parse(42)


def test_cast_requires_from_to():
    with pytest.raises(GrammarError) as e1:
        parse({"kind": "cast", "from": "TEXT"})
    assert e1.value.kind == "missing_field"
    with pytest.raises(GrammarError):
        parse({"kind": "cast", "from": 1, "to": "TEXT"})
    ast = parse({"kind": "cast", "from": "TEXT", "to": "VARCHAR"})
    assert ast["payload"]["to"] == "VARCHAR"


def test_concat_rejects_empty_or_non_list():
    for bad in [{}, {"kind": "concat", "parts": []}, {"kind": "concat", "parts": "x"}]:
        with pytest.raises(GrammarError):
            parse(bad)


def test_concat_validates_part_kinds():
    with pytest.raises(GrammarError):
        parse({"kind": "concat", "parts": [{"kind": "lambda", "value": "x"}]})
    with pytest.raises(GrammarError):
        parse({"kind": "concat", "parts": [{"kind": "literal", "value": 1}]})


def test_substring_out_of_range():
    with pytest.raises(GrammarError):
        compile_sql(
            {"kind": "substring", "source_index": 5, "start": 0, "length": 3},
            ["a", "b"], [],
        )


def test_substring_compiles_with_index():
    placeholders = []
    frag = compile_sql(
        {"kind": "substring", "source_index": 1, "start": 0, "length": 3},
        ["a", "b"], placeholders,
    )
    assert "SUBSTRING" in frag


def test_coalesce_compiles_with_literal_placeholder():
    placeholders = []
    frag = compile_sql(
        {"kind": "coalesce", "fallback_kind": "literal", "fallback_value": "n/a"},
        ["src"], placeholders,
    )
    assert frag == "COALESCE(%s, %s)"
    assert placeholders == ["n/a"]


def test_default_compiles():
    placeholders = []
    frag = compile_sql(
        {"kind": "default", "value_kind": "literal", "value": "X"},
        ["src"], placeholders,
    )
    assert frag == "COALESCE(%s, %s)"
    assert placeholders == ["X"]


def test_null_if_compiles():
    placeholders = []
    frag = compile_sql({"kind": "null_if", "equals": ""}, ["src"], placeholders)
    assert frag == "NULLIF(%s, %s)"
    assert placeholders == [""]


def test_lookup_with_optional_default():
    placeholders = []
    frag = compile_sql(
        {"kind": "lookup", "table": "lu_country",
         "key_column": "code", "value_column": "name"},
        ["src"], placeholders,
    )
    assert "SELECT name FROM lu_country" in frag
    assert "code = %s" in frag
    assert placeholders == []


def test_lookup_with_default_appends_placeholder():
    placeholders = []
    frag = compile_sql(
        {"kind": "lookup", "table": "lu_country",
         "key_column": "code", "value_column": "name", "default": "UNK"},
        ["src"], placeholders,
    )
    assert placeholders == ["UNK"]
    assert frag.count("%s") == 2


def test_upper_lower_trim_compile():
    for kind in ("upper", "lower", "trim"):
        frag = compile_sql({"kind": kind}, ["src"], [])
        assert "%s" in frag


def test_validate_is_idempotent():
    parse({"kind": "cast", "from": "INT", "to": "TEXT"})
    # second call must not raise
    parse({"kind": "cast", "from": "INT", "to": "TEXT"})


def test_concat_too_many_source_parts():
    with pytest.raises(GrammarError) as e:
        compile_sql(
            {"kind": "concat", "parts": [
                {"kind": "source"}, {"kind": "source"}, {"kind": "source"},
            ]},
            ["a"], [],
        )
    assert "concat" in e.value.location


def test_all_eleven_kinds_parse():
    kinds = [
        {"kind": "direct"},
        {"kind": "cast", "from": "TEXT", "to": "VARCHAR"},
        {"kind": "concat", "parts": [{"kind": "literal", "value": "x"}]},
        {"kind": "substring", "source_index": 0, "start": 0, "length": 5},
        {"kind": "coalesce", "fallback_kind": "literal", "fallback_value": "x"},
        {"kind": "upper"},
        {"kind": "lower"},
        {"kind": "trim"},
        {"kind": "default", "value_kind": "literal", "value": "x"},
        {"kind": "null_if", "equals": ""},
        {"kind": "lookup", "table": "t", "key_column": "k", "value_column": "v"},
    ]
    for k in kinds:
        ast = parse(k)
        assert ast["kind"] == k["kind"]
