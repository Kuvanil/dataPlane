"""external_action intent tests (aci_integration_tasks #4): routed to ACI
tool discovery + the governed approval queue — never NL2SQL, never ungated
execution; ambiguous targets get a clarifying question."""
from __future__ import annotations

import pytest

from app.models.audit import AuditLog
from app.models.autopilot import AutopilotRecommendation
from app.services.dba_intent_classifier import classify_intent


class _FakeAci:
    def __init__(self):
        self.searched = []

    def search_tools(self, query, limit=5):
        self.searched.append(query)
        return [{"name": "SLACK__CHAT_POST_MESSAGE"}]


@pytest.fixture()
def fake_aci_search(monkeypatch):
    fake = _FakeAci()
    monkeypatch.setattr("app.services.aci_client_service.aci_client.search_tools",
                        fake.search_tools)
    return fake


# ── Classification ───────────────────────────────────────────────────────

@pytest.mark.parametrize("question", [
    "post this table's PII findings to the #data-governance Slack channel",
    "email the data quality report to ops@example.com",
    "open a github issue for this schema drift",
    "create a jira ticket for the failed pipeline",
])
def test_external_requests_classify_external_action(question):
    c = classify_intent(question)
    assert c.intent == "external_action"
    assert c.handler == "aci_client_service"


@pytest.mark.parametrize("question", [
    "show me all customers from New York",
    "create new target schemas for retail analytics based on profiling with target tables",
    "how many employees are in each department?",
])
def test_non_external_requests_unaffected(question):
    assert classify_intent(question).intent != "external_action"


# ── Routing through the chat endpoint ────────────────────────────────────

def test_external_action_never_reaches_nl2sql(client_analyst, sqlite_conn_scanned,
                                              fake_aci_search, monkeypatch, db):
    from app.services.nl2sql_service import NL2SQLService

    def _boom(*args, **kwargs):
        raise AssertionError("generate_sql must not be called for external_action")

    monkeypatch.setattr(NL2SQLService, "generate_sql", staticmethod(_boom))

    resp = client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "post this table's PII findings to the #data-governance Slack channel",
    })
    body = resp.json()
    assert body["intent"] == "external_action"
    assert body["sql"] is None
    assert body["executed"] is False
    assert body["recommendation_id"] is not None
    assert "approval" in body["summary"].lower()
    assert fake_aci_search.searched  # tool discovery ran


def test_external_action_queues_approval_only_recommendation(
        client_analyst, sqlite_conn_scanned, fake_aci_search, db):
    resp = client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "email the data quality report to ops@example.com",
    })
    body = resp.json()
    rec = (
        db.query(AutopilotRecommendation)
        .filter(AutopilotRecommendation.id == body["recommendation_id"])
        .one()
    )
    assert rec.action_type == "external_email_send"
    assert rec.status == "pending"          # queued, NOT executed
    assert rec.payload["to"] == "ops@example.com"
    assert rec.risk == "high"


def test_channel_request_maps_to_message_send(client_analyst, sqlite_conn_scanned,
                                              fake_aci_search, db):
    client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "post the drift summary to #data-governance",
    })
    rec = db.query(AutopilotRecommendation).one()
    assert rec.action_type == "external_message_send"
    assert rec.payload["destination"] == "#data-governance"


def test_ticket_request_maps_to_ticket_create(client_analyst, sqlite_conn_scanned,
                                              fake_aci_search, db):
    client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "open a github issue for this schema drift",
    })
    rec = db.query(AutopilotRecommendation).one()
    assert rec.action_type == "external_ticket_create"


def test_unresolvable_target_asks_for_clarification(client_analyst, sqlite_conn_scanned,
                                                    fake_aci_search, db):
    resp = client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "email this report to the team",  # no address, no channel, no ticket words
    })
    body = resp.json()
    assert body["intent"] == "external_action"
    assert body["needs_clarification"] is True
    assert body["recommendation_id"] is None
    assert db.query(AutopilotRecommendation).count() == 0
    assert fake_aci_search.searched == []  # no discovery before a target exists


def test_external_action_request_audited(client_analyst, sqlite_conn_scanned,
                                         fake_aci_search, db):
    client_analyst.post("/api/v1/askdata/ask", json={
        "connection_id": sqlite_conn_scanned.id,
        "question": "create a jira ticket for the failed pipeline",
    })
    row = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "aci.external_action_requested")
        .one()
    )
    assert row.module == "aci_integration"
    assert row.event_metadata["action_type"] == "external_ticket_create"
    assert row.event_metadata["recommendation_id"] is not None
