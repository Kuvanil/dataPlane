"""Tests for the metric catalog + search + certified badges (Task #6).

Validates the search/filter behavior of the existing GET /semantic/metrics
endpoint and the lineage surfaced on GET /semantic/metrics/{id}. The
endpoints already exist from Task #1's CRUD work; this test suite
locks in the catalog-specific behaviors (FR4: searchable, certified
badges visible, lineage surfaced per metric).
"""
import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.connection import DBConnection
from app.models.schema_catalog import CatalogColumn, CatalogTable
from app.services.semantic_service import SemanticCRUD


@pytest.fixture()
def client(db, admin, monkeypatch):
    """FastAPI TestClient with auth + db overrides for the semantic router."""
    def _override():
        return admin
    def _get_db_override():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = _get_db_override
    # Re-import the auth dep getter since the router captured it via
    # `from app.api.routers.auth import get_current_user`.
    from app.api.routers import auth
    app.dependency_overrides[auth.get_current_user] = _override
    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


def _seed_catalog_table(db, conn_name="CatalogSrc"):
    conn = DBConnection(name=conn_name, type="sqlite", config={"path": f"/tmp/{conn_name.lower()}.db"})
    db.add(conn)
    db.commit()
    db.refresh(conn)
    table = CatalogTable(connection_id=conn.id, table_name="orders")
    db.add(table)
    db.commit()
    db.refresh(table)
    col = CatalogColumn(
        table_id=table.id, column_name="amount",
        data_type="NUMERIC", nullable=False, is_primary_key=False,
        ordinal_position=1,
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return col


def test_catalog_search_matches_name_substring(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="monthly_revenue",
        definition={"aggregation": "sum"}, description="Recurring revenue",
        actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="weekly_active_users",
        definition={"aggregation": "count_distinct"}, description="WAU",
        actor=admin.email,
    )
    res = client.get("/api/v1/semantic/metrics?search=monthly")
    assert res.status_code == 200
    rows = res.json()
    names = [r["name"] for r in rows]
    assert "monthly_revenue" in names
    assert "weekly_active_users" not in names


def test_catalog_search_matches_description_substring(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="m1",
        definition={"aggregation": "sum"}, description="Daily GMV",
        actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="m2",
        definition={"aggregation": "count"}, description="Weekly signups",
        actor=admin.email,
    )
    res = client.get("/api/v1/semantic/metrics?search=signups")
    rows = res.json()
    names = [r["name"] for r in rows]
    assert names == ["m2"]


def test_catalog_only_certified_true_returns_certified_only(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="certified_one",
        definition={"aggregation": "sum"}, certified=True, actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="experimental_one",
        definition={"aggregation": "count"}, certified=False, actor=admin.email,
    )
    res = client.get("/api/v1/semantic/metrics?only_certified=true")
    rows = res.json()
    names = [r["name"] for r in rows]
    assert "certified_one" in names
    assert "experimental_one" not in names


def test_catalog_only_certified_false_returns_experimental_only(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="cert_one",
        definition={"aggregation": "sum"}, certified=True, actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="exp_one",
        definition={"aggregation": "count"}, certified=False, actor=admin.email,
    )
    res = client.get("/api/v1/semantic/metrics?only_certified=false")
    rows = res.json()
    names = [r["name"] for r in rows]
    assert "exp_one" in names
    assert "cert_one" not in names


def test_catalog_only_published_excludes_drafts(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="draft_one",
        definition={"aggregation": "sum"}, actor=admin.email,
    )
    published_draft = SemanticCRUD.create_metric_draft(
        db, name="published_one",
        definition={"aggregation": "sum"}, actor=admin.email,
    )
    SemanticCRUD.publish(db, published_draft.id, actor=admin.email)
    res = client.get("/api/v1/semantic/metrics?only_published=true")
    rows = res.json()
    names = [r["name"] for r in rows]
    assert "published_one" in names
    assert "draft_one" not in names


def test_catalog_metric_detail_surfaces_lineage(client, db, admin):
    col = _seed_catalog_table(db)
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="revenue",
        definition={"aggregation": "sum"}, actor=admin.email,
    )
    SemanticCRUD.add_lineage(
        db, metric_id=draft.id, catalog_column_id=col.id,
        role="measure", actor=admin.email,
    )
    res = client.get(f"/api/v1/semantic/metrics/{draft.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "revenue"
    assert len(body["lineage"]) == 1
    assert body["lineage"][0]["catalog_column_id"] == col.id
    assert body["lineage"][0]["role"] == "measure"


def test_catalog_combined_search_and_certified_filter(client, db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="revenue_v1",
        definition={"aggregation": "sum"}, certified=True,
        description="Production revenue",
        actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="revenue_v2",
        definition={"aggregation": "sum"}, certified=False,
        description="Experimental revenue",
        actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="users_v1",
        definition={"aggregation": "count_distinct"}, certified=True,
        description="Active users",
        actor=admin.email,
    )
    res = client.get("/api/v1/semantic/metrics?search=revenue&only_certified=true")
    rows = res.json()
    names = [r["name"] for r in rows]
    assert names == ["revenue_v1"]  # certified + matches "revenue" + excludes users_v1
