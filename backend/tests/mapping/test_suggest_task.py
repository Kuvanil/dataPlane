"""suggest_mappings_task re-run semantics.

The suggester must behave like a DBA who remembers their own decisions:
- a *pending* suggestion is an open question — re-running the task must
  not duplicate it;
- a *rejected* (source → target) pair is a decision already made — the
  exact same match is never offered again, though a different source for
  that target column still can be.
"""
from __future__ import annotations

import pytest

from app.models.mapping import AISuggestion
from app.services.mapping_service import MappingService
from app.workers import mapping_tasks as mt


class _NoCloseSession:
    """Proxy that hands the task the test session but ignores close()."""

    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        if name == "close":
            return lambda: None
        return getattr(self._s, name)


def _fake_schema(_conn):
    return {
        "t1": [{"name": "c1", "type": "TEXT"}],
        "t2": [{"name": "c2", "type": "TEXT"}],
    }


def _fake_match(*, source_name, source_schema, target_name, target_schema):
    """Suggest same-named columns at confidence 90."""
    src_names = {c["name"] for c in source_schema}
    return {
        "matches": [
            {
                "source": c["name"], "target": c["name"],
                "confidence": 90, "reason": "name match",
            }
            for c in target_schema if c["name"] in src_names
        ],
    }


@pytest.fixture()
def patched_task_env(db, monkeypatch):
    monkeypatch.setattr(mt, "SessionLocal", lambda: _NoCloseSession(db))
    monkeypatch.setattr(
        mt.SchemaService, "get_full_schema", staticmethod(_fake_schema),
    )
    monkeypatch.setattr(
        mt.AIService, "match_schemas", staticmethod(_fake_match),
    )


def _make_mapping(db, admin, seeded_connections):
    src, tgt = seeded_connections
    return MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="M", actor=admin.email,
    )


def test_rerun_does_not_duplicate_pending_suggestions(
    db, admin, seeded_connections, patched_task_env,
):
    m = _make_mapping(db, admin, seeded_connections)

    first = mt.suggest_mappings_task.run(mapping_id=m.id)
    assert first["status"] == "completed"
    assert first["suggestions_created"] == 2  # t1.c1 and t2.c2

    second = mt.suggest_mappings_task.run(mapping_id=m.id)
    assert second["status"] == "completed"
    assert second["suggestions_created"] == 0

    total = (
        db.query(AISuggestion)
        .filter(AISuggestion.mapping_id == m.id)
        .count()
    )
    assert total == 2


def test_rerun_never_reoffers_a_rejected_match(
    db, admin, seeded_connections, patched_task_env,
):
    m = _make_mapping(db, admin, seeded_connections)

    first = mt.suggest_mappings_task.run(mapping_id=m.id)
    assert first["suggestions_created"] == 2

    # DBA rejects the t1.c1 → t1.c1 match.
    rejected = (
        db.query(AISuggestion)
        .filter(
            AISuggestion.mapping_id == m.id,
            AISuggestion.target_table == "t1",
            AISuggestion.target_column == "c1",
        )
        .one()
    )
    MappingService.reject_suggestion(db, m.id, rejected.id, actor=admin.email)

    # Re-run: t1.c1 is unmapped and has no pending suggestion, but its only
    # candidate match was rejected — it must NOT come back. t2.c2 is still
    # pending, so it must not be duplicated either.
    rerun = mt.suggest_mappings_task.run(mapping_id=m.id)
    assert rerun["status"] == "completed"
    assert rerun["suggestions_created"] == 0

    statuses = [
        s.status for s in
        db.query(AISuggestion).filter(AISuggestion.mapping_id == m.id).all()
    ]
    assert sorted(statuses) == ["pending", "rejected"]
