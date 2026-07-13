"""Tests for the pipeline execution engine (Task #3).

Covers: a clean run that actually copies rows through real SQLite files,
a run blocked by drift, a run that fails on an unsupported (non-direct)
transformation, and a re-run producing no duplicate rows (upsert on the
natural key).

Mirrors the SessionLocal-patching pattern in
tests/mapping/test_suggest_task.py — PipelineExecutor.execute() opens its
own session via SessionLocal() (as the real Celery task does), so tests
monkeypatch that module-level name to hand it the test's own session.
"""
import sqlite3

import pytest

from app.models.pipeline import PipelineRun
from app.services import pipeline_executor as pe
from app.services.pipeline_service import PipelineCRUD


class _NoCloseSession:
    """Proxy that hands the executor the test session but ignores close()."""

    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        if name == "close":
            return lambda: None
        return getattr(self._s, name)


@pytest.fixture()
def patched_executor_env(db, monkeypatch):
    monkeypatch.setattr(pe, "SessionLocal", lambda: _NoCloseSession(db))


def _create_pipeline_and_run(db, admin, physical_sqlite_connections, mapping, trigger="manual"):
    src, tgt = physical_sqlite_connections
    p = PipelineCRUD.create_pipeline(
        db, name="Exec Test", source_connection_id=src.id,
        target_connection_id=tgt.id, mapping_id=mapping.id, actor=admin.email,
    )
    run = PipelineRun(pipeline_id=p.id, status="pending", trigger=trigger)
    db.add(run)
    db.commit()
    db.refresh(run)
    return p, run


def test_execute_happy_path_copies_rows(
    db, admin, patched_executor_env, physical_sqlite_connections, seeded_mapping_with_field_mappings,
):
    mapping, _version = seeded_mapping_with_field_mappings
    p, run = _create_pipeline_and_run(db, admin, physical_sqlite_connections, mapping)

    result = pe.PipelineExecutor.execute(p.id, run.id, trigger="manual")

    assert result["status"] == "completed"
    assert result["rows_processed"] == 3

    _, tgt = physical_sqlite_connections
    conn = sqlite3.connect(tgt.config["path"])
    rows = conn.execute("SELECT cust_id, full_name, contact_email FROM customers ORDER BY cust_id").fetchall()
    conn.close()
    assert rows == [
        (1, "Alice", "alice@x.com"),
        (2, "Bob", "bob@x.com"),
        (3, "Cara", "cara@x.com"),
    ]

    db.refresh(run)
    assert run.status == "succeeded"
    assert run.rows_processed == 3
    assert run.finished_at is not None

    steps = db.query(pe.PipelineRunStep).filter(pe.PipelineRunStep.run_id == run.id).all()
    assert {s.step for s in steps} == {"extract", "transform", "load"}
    assert all(s.status == "succeeded" for s in steps)


def test_execute_rerun_upserts_no_duplicates(
    db, admin, patched_executor_env, physical_sqlite_connections, seeded_mapping_with_field_mappings,
):
    """A second run against the same pipeline must not duplicate rows —
    the natural key (cust_id, from the target's PK-flagged field mapping)
    drives an upsert, not a blind insert."""
    mapping, _version = seeded_mapping_with_field_mappings
    p, run1 = _create_pipeline_and_run(db, admin, physical_sqlite_connections, mapping)
    pe.PipelineExecutor.execute(p.id, run1.id, trigger="manual")

    run2 = PipelineRun(pipeline_id=p.id, status="pending", trigger="rerun", parent_run_id=run1.id)
    db.add(run2)
    db.commit()
    db.refresh(run2)
    result = pe.PipelineExecutor.execute(p.id, run2.id, trigger="rerun")

    assert result["status"] == "completed"
    _, tgt = physical_sqlite_connections
    conn = sqlite3.connect(tgt.config["path"])
    count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    conn.close()
    assert count == 3  # no duplicates


def test_execute_blocked_by_drift(
    db, admin, patched_executor_env, physical_sqlite_connections, seeded_mapping_with_field_mappings,
):
    mapping, _version = seeded_mapping_with_field_mappings
    p, run = _create_pipeline_and_run(db, admin, physical_sqlite_connections, mapping)

    src, _ = physical_sqlite_connections
    conn = sqlite3.connect(src.config["path"])
    conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    conn.commit()
    conn.close()

    result = pe.PipelineExecutor.execute(p.id, run.id, trigger="manual")

    assert result["status"] == "blocked"
    assert result["reason"] == "drift"
    db.refresh(run)
    assert run.status == "failed"
    assert "drift" in run.error_message.lower()


def test_execute_fails_clearly_on_unsupported_transformation(
    db, admin, patched_executor_env, physical_sqlite_connections, seeded_mapping_with_field_mappings,
):
    """A non-'direct' transformation must fail the run with an actionable
    message, not silently move untransformed data."""
    from app.models.mapping import FieldMapping

    mapping, version = seeded_mapping_with_field_mappings
    edge = db.query(FieldMapping).filter(
        FieldMapping.version_id == version.id, FieldMapping.target_column == "full_name",
    ).first()
    edge.transformation = {"kind": "upper"}
    db.commit()

    p, run = _create_pipeline_and_run(db, admin, physical_sqlite_connections, mapping)
    result = pe.PipelineExecutor.execute(p.id, run.id, trigger="manual")

    assert result["status"] == "failed"
    assert "direct" in result["error"].lower()
    assert "full_name" in result["error"]
    db.refresh(run)
    assert run.status == "failed"
