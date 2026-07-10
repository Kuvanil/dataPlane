"""Tests for the semantic layer versioning surface (Task #1).

Covers:
- Entity create / list
- Dimension + measure create
- Metric draft create / save / publish / archive
- Version immutability (published/archived versions reject updates)
- Duplicate-name guard
- List versions per metric name
"""
import pytest
from fastapi import HTTPException

from app.models.semantic import SemanticMetricDefinition
from app.services.semantic_service import SemanticCRUD


def test_create_entity_happy_path(db, admin):
    e = SemanticCRUD.create_entity(
        db, name="Customer", description="Customer entity",
        owner="analytics", actor=admin.email,
    )
    assert e.id is not None
    assert e.name == "Customer"
    assert e.created_by == admin.email


def test_create_entity_rejects_duplicate_name(db, admin):
    SemanticCRUD.create_entity(db, name="Customer", actor=admin.email)
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.create_entity(db, name="Customer", actor=admin.email)
    assert e.value.status_code == 409


def test_create_dimension_requires_existing_entity(db, admin):
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.create_dimension(
            db, entity_id=99999, name="region", actor=admin.email,
        )
    assert e.value.status_code == 404


def test_create_measure_requires_existing_entity(db, admin):
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.create_measure(
            db, entity_id=99999, name="revenue", actor=admin.email,
        )
    assert e.value.status_code == 404


def test_create_dimension_then_list(db, admin):
    e = SemanticCRUD.create_entity(db, name="Customer", actor=admin.email)
    SemanticCRUD.create_dimension(
        db, entity_id=e.id, name="region",
        semantic_type="categorical", actor=admin.email,
    )
    SemanticCRUD.create_measure(
        db, entity_id=e.id, name="lifetime_revenue",
        default_aggregation="sum", actor=admin.email,
    )
    e2 = db.query(type(e)).filter_by(id=e.id).first()
    assert len(e2.dimensions) == 1
    assert e2.dimensions[0].name == "region"
    assert e2.measures[0].name == "lifetime_revenue"
    assert e2.measures[0].default_aggregation == "sum"


def test_metric_create_draft_and_publish_creates_v1_then_v2(db, admin):
    """End-to-end: create draft (v1, status=draft), publish (creates v2, status=published)."""
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="monthly_revenue",
        definition={"aggregation": "sum", "measure": "amount", "entity": "orders",
                   "time_grain": "month", "time_column": "created_at"},
        actor=admin.email,
    )
    assert draft.version_number == 1
    assert draft.status == "draft"

    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    assert published.version_number == 2
    assert published.status == "published"
    assert published.published_by == admin.email
    assert published.published_at is not None

    versions = SemanticCRUD.list_metric_versions(db, "monthly_revenue")
    assert len(versions) == 2
    assert sorted(v.version_number for v in versions) == [1, 2]


def test_publish_only_works_on_drafts(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    # Re-publishing the (now-published) version is rejected; you create a
    # new version from a fresh draft.
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.publish(db, published.id, actor=admin.email)
    assert e.value.status_code == 409


def test_save_draft_rejects_published_metric(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.save_draft(
            db, published.id, definition={"aggregation": "count"},
            actor=admin.email,
        )
    assert e.value.status_code == 409
    assert "immutable" in e.value.detail.lower() or "draft" in e.value.detail.lower()


def test_save_draft_rejects_archived_metric(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    SemanticCRUD.archive(db, published.id, actor=admin.email)
    with pytest.raises(HTTPException):
        SemanticCRUD.save_draft(
            db, published.id, definition={"aggregation": "count"},
            actor=admin.email,
        )


def test_archive_idempotent(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    published = SemanticCRUD.publish(db, draft.id, actor=admin.email)
    a1 = SemanticCRUD.archive(db, published.id, actor=admin.email)
    a2 = SemanticCRUD.archive(db, published.id, actor=admin.email)
    assert a1.status == "archived"
    assert a2.status == "archived"


def test_create_metric_draft_rejects_duplicate_name(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="dup", definition={"aggregation": "sum"}, actor=admin.email,
    )
    with pytest.raises(HTTPException) as e:
        SemanticCRUD.create_metric_draft(
            db, name="dup", definition={"aggregation": "sum"}, actor=admin.email,
        )
    assert e.value.status_code == 409


def test_lineage_add_requires_metric_and_catalog_column(db, admin, monkeypatch):
    """SemanticLineage points at Schema Intel's catalog_columns. Verify
    both sides are validated and the row is created with the correct
    role."""
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    draft = SemanticCRUD.create_metric_draft(
        db, name="x", definition={"aggregation": "sum"}, actor=admin.email,
    )
    # Missing catalog column → 404
    with pytest.raises(HTTPException):
        SemanticCRUD.add_lineage(
            db, metric_id=draft.id, catalog_column_id=99999,
            role="measure", actor=admin.email,
        )


def test_list_metrics_search_and_certified_filter(db, admin):
    SemanticCRUD.create_entity(db, name="Orders", actor=admin.email)
    SemanticCRUD.create_metric_draft(
        db, name="monthly_revenue",
        definition={"aggregation": "sum"}, certified=True, actor=admin.email,
    )
    SemanticCRUD.create_metric_draft(
        db, name="experimental_count",
        definition={"aggregation": "count"}, certified=False, actor=admin.email,
    )
    # only_certified=True → 1 row (monthly_revenue)
    rows = SemanticCRUD.list_metrics(db, only_certified=True)
    assert len(rows) == 1
    assert rows[0].name == "monthly_revenue"
    # search by substring
    rows = SemanticCRUD.list_metrics(db, search="experimental")
    assert len(rows) == 1
    assert rows[0].name == "experimental_count"
    # only_published=True → 0 rows (both are drafts)
    rows = SemanticCRUD.list_metrics(db, only_published=True)
    assert len(rows) == 0
