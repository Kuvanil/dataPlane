"""Tests for GET /api/v1/dashboard/summary (dashboard_tasks #1)."""
from sqlalchemy import text

EXPECTED_LABELS = {
    "Connected Sources", "Mappings", "Pipelines Running", "Pipelines Failed",
    "Queries", "Security Alerts", "Drift Events", "AI Autopilot Actions",
}


class TestDashboardSummary:
    def test_returns_200_with_envelope(self, client, seed_data):
        resp = client.get("/api/v1/dashboard/summary?range=7d")
        assert resp.status_code == 200
        data = resp.json()
        assert data["range"] == "7d"
        assert "generated_at" in data
        assert isinstance(data["kpis"], list)
        assert isinstance(data["feed"], list)

    def test_all_eight_tiles_present(self, client, seed_data):
        data = client.get("/api/v1/dashboard/summary").json()
        assert {k["label"] for k in data["kpis"]} == EXPECTED_LABELS

    def test_default_range_is_7d(self, client, seed_data):
        assert client.get("/api/v1/dashboard/summary").json()["range"] == "7d"

    def test_invalid_range_returns_422(self, client):
        assert client.get("/api/v1/dashboard/summary?range=nope").status_code == 422

    def test_anonymous_returns_401(self, make_client):
        resp = make_client(None).get("/api/v1/dashboard/summary")
        assert resp.status_code == 401

    def test_seeded_counts(self, client, seed_data):
        tiles = {k["label"]: k for k in
                 client.get("/api/v1/dashboard/summary?range=7d").json()["kpis"]}
        assert tiles["Connected Sources"]["value"] == 2
        # Soft-deleted mapping excluded.
        assert tiles["Mappings"]["value"] == 1
        assert tiles["Pipelines Running"]["value"] == 1
        # 40-day-old failure excluded from the 7d window.
        assert tiles["Pipelines Failed"]["value"] == 1
        assert tiles["Queries"]["value"] == 2
        assert tiles["Security Alerts"]["value"] == 1
        assert tiles["Drift Events"]["value"] == 1
        assert tiles["AI Autopilot Actions"]["value"] == 1

    def test_range_24h_excludes_older_rows(self, client, seed_data):
        tiles = {k["label"]: k for k in
                 client.get("/api/v1/dashboard/summary?range=24h").json()["kpis"]}
        # q2 is 2 days old.
        assert tiles["Queries"]["value"] == 1
        # Running is current state, not range-scoped.
        assert tiles["Pipelines Running"]["value"] == 1

    def test_empty_system_returns_zero_counts(self, client):
        data = client.get("/api/v1/dashboard/summary").json()
        assert {k["label"] for k in data["kpis"]} == EXPECTED_LABELS
        for kpi in data["kpis"]:
            assert kpi["status"] == "loaded"
            assert kpi["value"] == 0
        assert data["feed"] == []

    def test_each_tile_has_required_fields(self, client, seed_data):
        for kpi in client.get("/api/v1/dashboard/summary").json()["kpis"]:
            assert kpi["status"] in ("loaded", "error", "unavailable")
            assert isinstance(kpi["value"], int)
            assert kpi["link_url"]
            assert kpi["module"]

    def test_feed_reverse_chronological_and_range_scoped(self, client, seed_data):
        feed = client.get("/api/v1/dashboard/summary?range=30d").json()["feed"]
        assert len(feed) == 4  # the 40-day-old mapping_created event is excluded
        timestamps = [item["created_at"] for item in feed]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_feed_items_enriched_with_module_and_link(self, client, seed_data):
        feed = client.get("/api/v1/dashboard/summary").json()["feed"]
        by_type = {item["event_type"]: item for item in feed}
        connector = by_type["connector_created"]
        assert connector["module"] == "connectors"
        assert connector["link_url"] == "/dashboard/connectors"
        assert "Src" in connector["summary"]
        drift = by_type["schema_drift_detected"]
        assert drift["module"] == "schema_intel"
        assert drift["link_url"] == "/dashboard/schema"
        for item in feed:
            assert item["actor"]
            assert item["summary"]

    def test_broken_module_degrades_to_tile_not_500(self, client, engine, seed_data):
        """Per-module isolation (FR6): a missing table yields an
        'unavailable' tile and must not poison the other module queries."""
        with engine.connect() as conn:
            conn.execute(text("DROP TABLE pipeline_runs"))
            conn.commit()
        resp = client.get("/api/v1/dashboard/summary")
        assert resp.status_code == 200
        tiles = {k["label"]: k for k in resp.json()["kpis"]}
        assert tiles["Pipelines Running"]["status"] == "unavailable"
        assert tiles["Pipelines Failed"]["status"] == "unavailable"
        # Modules queried after the failure still load (session recovered).
        assert tiles["Queries"]["status"] == "loaded"
        assert tiles["Drift Events"]["status"] == "loaded"
        assert len(resp.json()["feed"]) > 0
