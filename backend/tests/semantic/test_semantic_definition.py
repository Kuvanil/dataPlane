"""Unit tests for the semantic definition language (DP-SEM-001, SEM-T1 full).

Mirrors the test structure of test_transformation_grammar.py for the
Schema Mapper grammar — same allow-list / grammar-error conventions.
"""
import pytest

from app.services.semantic_definition import (
    ALLOWED_AGGREGATIONS,
    ALLOWED_FILTER_OPS,
    ALLOWED_JOIN_TYPES,
    ALLOWED_TIME_GRAINS,
    GrammarError,
    compile_sql,
    parse,
)


# ── Happy path ───────────────────────────────────────────────────


def test_parse_minimal_definition():
    """Required fields only: entity, measure, aggregation."""
    out = parse({"entity": "orders", "measure": "amount", "aggregation": "sum"})
    assert out == {
        "entity": "orders", "measure": "amount", "aggregation": "sum",
        "filters": [], "joins": [],
    }


def test_parse_full_definition():
    out = parse({
        "entity": "orders",
        "measure": "amount",
        "aggregation": "avg",
        "filters": [
            {"column": "status", "op": "=", "value": "paid"},
            {"column": "created_at", "op": ">=", "value": "2024-01-01"},
        ],
        "joins": [
            {"table": "customers",
             "on": {"left": "orders.customer_id", "right": "customers.id"},
             "type": "left"},
        ],
        "time_grain": "month",
        "time_column": "created_at",
    })
    assert out["filters"][0] == {"column": "status", "op": "=", "value": "paid"}
    assert out["joins"][0]["type"] == "left"
    assert out["time_grain"] == "month"


# ── Allowed aggregations ─────────────────────────────────────────


@pytest.mark.parametrize("agg", sorted(ALLOWED_AGGREGATIONS))
def test_parse_accepts_every_allowed_aggregation(agg):
    parse({"entity": "x", "measure": "y", "aggregation": agg})


def test_parse_rejects_unknown_aggregation():
    with pytest.raises(GrammarError) as e:
        parse({"entity": "x", "measure": "y", "aggregation": "median"})
    assert e.value.kind == "bad_enum"


# ── Filters ──────────────────────────────────────────────────────


@pytest.mark.parametrize("op", sorted(ALLOWED_FILTER_OPS))
def test_parse_accepts_every_allowed_filter_op(op):
    value = (
        None if op in {"is_null", "is_not_null"}
        else [1, 2, 3] if op in {"in", "not_in"}
        else 42
    )
    f: dict = {"column": "c", "op": op, "value": value}
    parse({"entity": "x", "measure": "y", "aggregation": "sum", "filters": [f]})


def test_parse_rejects_unknown_filter_op():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "filters": [{"column": "c", "op": "LIKE", "value": "%a%"}],
        })


def test_parse_rejects_is_null_with_value():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "filters": [{"column": "c", "op": "is_null", "value": "n/a"}],
        })


def test_parse_rejects_in_with_scalar_value():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "filters": [{"column": "c", "op": "in", "value": 1}],
        })


def test_parse_rejects_filter_missing_value():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "filters": [{"column": "c", "op": "="}],
        })


# ── Joins ────────────────────────────────────────────────────────


@pytest.mark.parametrize("jtype", sorted(ALLOWED_JOIN_TYPES))
def test_parse_accepts_every_allowed_join_type(jtype):
    parse({
        "entity": "x", "measure": "y", "aggregation": "sum",
        "joins": [{
            "table": "z",
            "on": {"left": "x.a", "right": "z.b"},
            "type": jtype,
        }],
    })


def test_parse_rejects_unknown_join_type():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "joins": [{
                "table": "z",
                "on": {"left": "x.a", "right": "z.b"},
                "type": "cross",
            }],
        })


def test_parse_rejects_join_missing_on_keys():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "joins": [{"table": "z", "on": {}, "type": "inner"}],
        })


# ── Time grain ──────────────────────────────────────────────────


@pytest.mark.parametrize("grain", sorted(ALLOWED_TIME_GRAINS))
def test_parse_accepts_every_allowed_time_grain(grain):
    parse({
        "entity": "x", "measure": "y", "aggregation": "sum",
        "time_grain": grain, "time_column": "created_at",
    })


def test_parse_rejects_unknown_time_grain():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "time_grain": "fortnight", "time_column": "created_at",
        })


def test_parse_rejects_time_grain_without_time_column():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "time_grain": "month",
        })


def test_parse_rejects_time_column_without_time_grain():
    with pytest.raises(GrammarError):
        parse({
            "entity": "x", "measure": "y", "aggregation": "sum",
            "time_column": "created_at",
        })


# ── Required fields ──────────────────────────────────────────────


def test_parse_rejects_non_object_payload():
    with pytest.raises(GrammarError):
        parse("not an object")
    with pytest.raises(GrammarError):
        parse(None)


def test_parse_rejects_missing_entity():
    with pytest.raises(GrammarError) as e:
        parse({"measure": "y", "aggregation": "sum"})
    assert e.value.kind == "missing_field"
    assert e.value.location == "entity"


def test_parse_rejects_missing_measure():
    with pytest.raises(GrammarError) as e:
        parse({"entity": "x", "aggregation": "sum"})
    assert e.value.location == "measure"


def test_parse_rejects_missing_aggregation():
    with pytest.raises(GrammarError) as e:
        parse({"entity": "x", "measure": "y"})
    assert e.value.location == "aggregation"


# ── SQL compilation ────────────────────────────────────────────


def test_compile_sql_minimal():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum"},
        placeholders,
    )
    assert sql == "SELECT SUM(orders.amount) AS value FROM orders"
    assert placeholders == []


def test_compile_sql_with_scalar_filter():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum",
         "filters": [{"column": "status", "op": "=", "value": "paid"}]},
        placeholders,
    )
    assert sql == (
        "SELECT SUM(orders.amount) AS value FROM orders "
        "WHERE status = %s"
    )
    assert placeholders == ["paid"]


def test_compile_sql_with_in_filter():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum",
         "filters": [{"column": "status", "op": "in",
                      "value": ["paid", "shipped"]}]},
        placeholders,
    )
    assert sql == (
        "SELECT SUM(orders.amount) AS value FROM orders "
        "WHERE status IN (%s,%s)"
    )
    assert placeholders == ["paid", "shipped"]


def test_compile_sql_with_is_null():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum",
         "filters": [{"column": "status", "op": "is_null", "value": None}]},
        placeholders,
    )
    assert sql == (
        "SELECT SUM(orders.amount) AS value FROM orders WHERE status IS NULL"
    )
    assert placeholders == []


def test_compile_sql_with_join():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum",
         "joins": [{"table": "customers",
                    "on": {"left": "orders.customer_id", "right": "customers.id"},
                    "type": "left"}]},
        placeholders,
    )
    assert sql == (
        "SELECT SUM(orders.amount) AS value FROM orders "
        "LEFT JOIN customers ON orders.customer_id = customers.id"
    )


def test_compile_sql_with_time_grain_and_group_by():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "sum",
         "time_grain": "month", "time_column": "created_at"},
        placeholders,
    )
    assert "DATE_TRUNC('month', orders.created_at) AS bucket" in sql
    assert "GROUP BY bucket" in sql


def test_compile_sql_combines_filters_with_joins_and_grain():
    placeholders: list = []
    sql = compile_sql(
        {"entity": "orders", "measure": "amount", "aggregation": "avg",
         "filters": [
             {"column": "status", "op": "=", "value": "paid"},
             {"column": "amount", "op": ">", "value": 100},
         ],
         "joins": [{
             "table": "customers",
             "on": {"left": "orders.customer_id", "right": "customers.id"},
             "type": "inner",
         }],
         "time_grain": "day", "time_column": "created_at"},
        placeholders,
    )
    assert sql.startswith("SELECT DATE_TRUNC('day', orders.created_at) AS bucket, "
                          "AVG(orders.amount) AS value FROM orders")
    assert "INNER JOIN customers ON orders.customer_id = customers.id" in sql
    assert "WHERE status = %s AND amount > %s" in sql
    assert sql.endswith(" GROUP BY bucket")
    assert placeholders == ["paid", 100]


def test_compile_sql_rejects_invalid_definition():
    """compile_sql runs parse() first, so invalid definitions fail with
    GrammarError before any SQL is generated."""
    with pytest.raises(GrammarError):
        compile_sql(
            {"entity": "x", "measure": "y", "aggregation": "median"},
            [],
        )
