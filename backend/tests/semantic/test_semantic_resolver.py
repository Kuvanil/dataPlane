"""Tests for the semantic query resolution engine (DP-SEM-001 Task #5).

Covers:
- Reject drafts / unknown metric versions
- Build correct SELECT/FROM/WHERE from a published metric + lineage
- Substitute the lineage's catalog_column for the definition's "measure"
- Caller-supplied filters add AND clauses to the WHERE
- Lineage that points to deleted catalog columns → ResolutionError
- Lineage with no measure column → ResolutionError
"""
import pytest

from app.models.connection import DBConnection
from app.models.schema_catalog import CatalogColumn, CatalogTable
from app.models.semantic import SemanticLineage
from app.services.semantic_resolver import ResolutionError, resolve
from app.services.semantic_service import SemanticCRUD


def _seed_orders_catalog(db, conn_name="OrdersTest0"):
    """Helper: create a CatalogConnection + CatalogTable 'orders' +
    CatalogColumns 'amount' and 'created_at'."""
    conn = DBConnection(name="Orders", type="sqlite", config={"path": "/tmp/x.db"})
    db.add(conn)
    db.commit()
    db.refresh(conn)
    table = CatalogTable(connection_id=conn.id, table_name="orders")
    db.add(table)
    db.commit()
    db.refresh(table)
    amount = CatalogColumn(
        table_id=table.id, column_name="amount",
        data_type="NUMERIC", nullable=False, is_primary_key=False,
        ordinal_position=1,
    )
    created = CatalogColumn(
        table_id=table.id, column_name="created_at",
        data_type="TIMESTAMP", nullable=False, is_primary_key=False,
        ordinal_position=2,
    )
    db.add_all([amount, created])
    db.commit()
    db.refresh(amount)
    db.refresh(created)
    return conn, table, amount, created


def test_resolve_rejects_unknown_metric(db):
    with pytest.raises(ResolutionError) as e:
        resolve(db, 99999)
    assert "not found" in str(e.value)


def test_resolve_rejects_draft_metric(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    with pytest.raises(ResolutionError) as e:
        resolve(db, draft.id)
    assert "draft" in str(e.value).lower()


def test_resolve_rejects_metric_without_lineage(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersTest1")
    draft = SemanticCRUD.create_metric_draft(
        db, name="x",
        definition={"entity": "orders", "measure": "amount",
                   "aggregation": "sum"},
        actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    with pytest.raises(ResolutionError) as e:
        resolve(db, published.id)
    assert "lineage" in str(e.value).lower()


def test_resolve_simple_sum_metric(db, admin):
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersTest2")
    SemanticCRUD.create_entity(db, name="orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="revenue",
        definition={"entity": "orders", "measure": "amount",
                   "aggregation": "sum"},
        actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="measure", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)

    sql, placeholders = resolve(db, published.id)
    assert sql == "SELECT SUM(orders.amount) AS value FROM orders"
    assert placeholders == []


def test_resolve_substitutes_catalog_column_for_measure(db, admin):
    """The definition says 'measure': 'amount', but the physical column
    is bound via lineage. The resolver substitutes the catalog column
    name (which may differ from the logical measure name) into the SQL."""
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersTest3")
    SemanticCRUD.create_entity(db, name="orders", actor=admin.email)
    # Definition uses a logical name; the lineage binds it to a
    # physical column with a different (but matching by lineage.role)
    # physical name.
    draft = SemanticCRUD.create_metric_draft(
        db, name="revenue",
        definition={"entity": "orders", "measure": "revenue_total",
                   "aggregation": "sum"},
        actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="measure", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    sql, _ = resolve(db, published.id)
    # The resolver uses the catalog column name (amount), not the logical
    # name (revenue_total), because lineage is the binding source of truth.
    assert "SUM(orders.amount)" in sql


def test_resolve_with_caller_supplied_filters(db, admin):
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersTest4")
    SemanticCRUD.create_entity(db, name="orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="paid_revenue",
        definition={"entity": "orders", "measure": "amount",
                   "aggregation": "sum",
                   "filters": [{"column": "status", "op": "=",
                                "value": "paid"}]},
        actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="measure", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    sql, placeholders = resolve(
        db, published.id, filters={"region": "us-east"},
    )
    # Both the definition's "status = paid" filter AND the caller's
    # "region = us-east" filter are present.
    assert "WHERE status = %s AND region = %s" in sql
    assert placeholders == ["paid", "us-east"]


def test_resolve_rejects_when_lineage_lacks_measure_role(db, admin):
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersMeasure")
    SemanticCRUD.create_entity(db, name="orders_measure", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x",
        definition={"entity": "orders_measure", "measure": "amount",
                   "aggregation": "sum"},
        actor=admin.email,
    )
    # Add a dimension-only lineage (no measure role).
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="dimension", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    with pytest.raises(ResolutionError) as e:
        resolve(db, published.id)
    assert "measure" in str(e.value).lower()


def test_resolve_handles_deleted_catalog_column_lineage(db, admin):
    """If a catalog column referenced by lineage is deleted (ON DELETE SET
    NULL on lineage.catalog_column_id), the lineage row survives but the
    resolver rejects with a clear message."""
    _, _, amount, _ = _seed_orders_catalog(db, conn_name="OrdersDeletedLineage")
    SemanticCRUD.create_entity(db, name="orders_deleted_lineage_entity", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x_deleted",
        definition={"entity": "orders_deleted_lineage_entity", "measure": "amount",
                   "aggregation": "sum"},
        actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="measure", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    # Simulate the column being deleted.
    db.delete(amount)
    db.commit()
    with pytest.raises(ResolutionError) as e:
        resolve(db, published.id)
    assert "lineage" in str(e.value).lower() or "no physical table" in str(e.value).lower()


def test_resolve_with_time_grain_and_dimension(db, admin):
    """Full path: metric with time_grain + caller-supplied filter +
    lineage. Verify GROUP BY bucket appears."""
    _, _, amount, created = _seed_orders_catalog(db, conn_name="OrdersTest6")
    SemanticCRUD.create_entity(db, name="orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="monthly_revenue",
        definition={"entity": "orders", "measure": "amount",
                   "aggregation": "sum",
                   "time_grain": "month", "time_column": "created_at"},
        actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=amount.id,
        role="measure", actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=created.id,
        role="time", actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    sql, placeholders = resolve(db, published.id)
    assert "DATE_TRUNC('month', orders.created_at) AS bucket" in sql
    assert "GROUP BY bucket" in sql
