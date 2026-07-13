"""Tests for the Schema Topology graph fix: real published Schema Mapper
mappings must override exact-name-only false positives (bug: a renamed
table with a real, working, published mapping — e.g. crm_users ->
dw_customers — was flagged "not found in target schema", and the AI-match
edge always connected the first source/target node regardless of which
tables were actually compared).
"""
import pytest

from app.api.routers.schema import _get_real_table_mappings
from app.services.diff_service import DiffService


SOURCE_SCHEMA = {
    "users": [
        {"name": "id", "type": "INTEGER"},
        {"name": "name", "type": "TEXT"},
        {"name": "email", "type": "TEXT"},
    ],
    "leads": [
        {"name": "id", "type": "INTEGER"},
        {"name": "company", "type": "TEXT"},
    ],
}
TARGET_SCHEMA = {
    "customers": [
        {"name": "cust_id", "type": "INTEGER"},
        {"name": "full_name", "type": "TEXT"},
        {"name": "contact_email", "type": "TEXT"},
    ],
}


def _diff():
    return DiffService.compare_schemas(SOURCE_SCHEMA, TARGET_SCHEMA)


class TestGenerateGraphDataRealMappings:
    def test_without_real_mappings_renamed_table_flagged_not_found(self):
        """Baseline: exact-name matching alone can't see a rename."""
        graph = DiffService.generate_graph_data(SOURCE_SCHEMA, TARGET_SCHEMA, _diff())
        users_node = next(n for n in graph["nodes"] if n["id"] == "src_users")
        assert users_node["has_issues"] is True
        assert any("users" in a["message"] for a in graph["annotations"])

    def test_real_mapping_suppresses_false_not_found(self):
        real_mappings = {"users": {"target_table": "customers", "field_count": 3}}
        graph = DiffService.generate_graph_data(
            SOURCE_SCHEMA, TARGET_SCHEMA, _diff(), real_mappings=real_mappings,
        )
        users_node = next(n for n in graph["nodes"] if n["id"] == "src_users")
        customers_node = next(n for n in graph["nodes"] if n["id"] == "tgt_customers")
        assert users_node["has_issues"] is False
        assert customers_node["has_issues"] is False
        assert not any("'users'" in a["message"] for a in graph["annotations"])

    def test_real_mapping_draws_published_mapping_edge_with_field_count(self):
        real_mappings = {"users": {"target_table": "customers", "field_count": 3}}
        graph = DiffService.generate_graph_data(
            SOURCE_SCHEMA, TARGET_SCHEMA, _diff(), real_mappings=real_mappings,
        )
        edge = next(e for e in graph["edges"] if e["type"] == "published_mapping")
        assert edge["source"] == "src_users"
        assert edge["target"] == "tgt_customers"
        assert edge["label"] == "Mapped (3 fields)"

    def test_unmapped_table_still_flagged(self):
        """'leads' has no real mapping and no name match — still a real gap."""
        real_mappings = {"users": {"target_table": "customers", "field_count": 3}}
        graph = DiffService.generate_graph_data(
            SOURCE_SCHEMA, TARGET_SCHEMA, _diff(), real_mappings=real_mappings,
        )
        leads_node = next(n for n in graph["nodes"] if n["id"] == "src_leads")
        assert leads_node["has_issues"] is True
        assert any("'leads'" in a["message"] for a in graph["annotations"])

    def test_summary_counts_reflect_real_mappings(self):
        real_mappings = {"users": {"target_table": "customers", "field_count": 3}}
        graph = DiffService.generate_graph_data(
            SOURCE_SCHEMA, TARGET_SCHEMA, _diff(), real_mappings=real_mappings,
        )
        # matched via real_mappings (users) + 0 exact-name matches; only
        # 'leads' remains genuinely missing.
        assert graph["summary"]["matched_tables"] == 1
        assert graph["summary"]["missing_in_target"] == 1
        assert graph["summary"]["missing_in_source"] == 0

    def test_ai_match_edge_connects_the_actual_compared_pair_not_first_nodes(self):
        """Regression test for the bug where the AI-match edge always
        connected the first source node to the first target node,
        regardless of which two tables AIService.match_schemas actually
        compared."""
        ai_matches = [{"source": "company", "target": "full_name", "confidence": 42}]
        graph = DiffService.generate_graph_data(
            SOURCE_SCHEMA, TARGET_SCHEMA, _diff(),
            ai_matches=ai_matches, ai_match_pair=("leads", "customers"),
        )
        ai_edges = [e for e in graph["edges"] if e["type"] == "ai_match"]
        assert len(ai_edges) == 1
        assert ai_edges[0]["source"] == "src_leads"
        assert ai_edges[0]["target"] == "tgt_customers"

    def test_no_ai_match_edge_without_ai_match_pair(self):
        """If the caller didn't say which pair it compared, don't guess —
        previously this silently wired the edge to the first node pair."""
        ai_matches = [{"source": "company", "target": "full_name", "confidence": 42}]
        graph = DiffService.generate_graph_data(SOURCE_SCHEMA, TARGET_SCHEMA, _diff(), ai_matches=ai_matches)
        assert not any(e["type"] == "ai_match" for e in graph["edges"])


class TestGetRealTableMappings:
    def test_groups_field_mappings_by_table_pair(self, db, seeded_mapping_with_field_mappings):
        m, v = seeded_mapping_with_field_mappings
        src_id, tgt_id = m.source_id, m.target_id

        result = _get_real_table_mappings(db, src_id, tgt_id)

        assert result == {"users": {"target_table": "customers", "field_count": 3}}

    def test_returns_empty_when_no_published_mapping_exists(self, db, physical_sqlite_connections):
        src, tgt = physical_sqlite_connections
        assert _get_real_table_mappings(db, src.id, tgt.id) == {}

    def test_returns_empty_for_draft_mapping(self, db, physical_sqlite_connections):
        from app.models.mapping import Mapping

        src, tgt = physical_sqlite_connections
        db.add(Mapping(name="Draft", source_id=src.id, target_id=tgt.id, status="draft", created_by="test"))
        db.commit()

        assert _get_real_table_mappings(db, src.id, tgt.id) == {}
