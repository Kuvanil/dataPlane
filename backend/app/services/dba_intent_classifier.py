"""Intent classification for AskData (agentic_dba_tasks #1 + #10).

Task #1 shipped the deterministic keyword gate; task #10 restructured it as
a REGISTRY of intent handlers, mirroring autopilot_registry.py's allow-list
pattern: each entry declares an intent name, a deterministic matcher, and a
handler reference (routing hint). Adding a future intent ("propose an index
for a slow query", "add a DQ check to table X") means registering a new
IntentSpec — not touching the classification core.

Classification stays deterministic/pattern-based on purpose (cheap, fast,
auditable, offline-testable). Swapping in an LLM classifier is a separate,
future decision if pattern-matching proves insufficient — not this module's
job.

Word-boundary regexes are used for build verbs in base form on purpose:
r"\bcreate\b" does NOT match "created", so "show me tables created last
week" stays a read query.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

# ── Result types ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IntentClassification:
    intent: str  # registered intent name | "ambiguous"
    confidence: float  # 0.0-1.0
    matched_signal: str  # human-readable audit trail of what fired
    handler: Optional[str] = None  # routing hint from the winning IntentSpec


@dataclass(frozen=True)
class IntentSpec:
    """One registered intent. matcher(question) returns None (no match) or
    (score, confidence, signal) — score is used for arbitration between
    intents, confidence is reported outward."""
    name: str
    matcher: Callable[[str], Optional[Tuple[float, float, str]]]
    handler: str  # e.g. "agentic_dba_engine" | "nl2sql" — documentation of routing
    priority: int = 0  # tie-breaker: higher wins on equal score


# ── Built-in matchers (task #1 semantics, unchanged) ─────────────────────

_BUILD_VERBS = re.compile(
    r"\b(create|design|build|generate|construct|provision|set\s+up|scaffold|add)\b",
    re.IGNORECASE,
)
_BUILD_NOUNS = re.compile(
    r"\b("
    r"schemas?|tables?|pipelines?|transformations?|"
    r"data\s+quality|dq\s+(?:rules?|steps?|checks?)|"
    r"warehouse|data\s+mart|dimensions?|fact\s+tables?|"
    r"star\s+schema|snowflake\s+schema|etl|target\s+tables?|"
    r"migrations?|ddl|indexes?|views?"
    r")\b",
    re.IGNORECASE,
)
_READ_SIGNALS = re.compile(
    r"\b("
    r"show|list|display|find|give\s+me|fetch|get|"
    r"count|how\s+many|how\s+much|what\s+is|what\s+are|what's|"
    r"which|who|where|when|top\s+\d+|average|avg|total|sum|"
    r"describe|select"
    r")\b",
    re.IGNORECASE,
)


def _match_schema_design(text: str) -> Optional[Tuple[float, float, str]]:
    verbs = _BUILD_VERBS.findall(text)
    nouns = _BUILD_NOUNS.findall(text)
    if not (verbs and nouns):
        return None
    # A build intent needs BOTH a build verb and a build noun — "create"
    # alone ("who created this?") or "tables" alone ("show all tables")
    # is not enough.
    score = min(len(verbs), 1) + min(len(nouns), 2)
    confidence = min(1.0, 0.6 + 0.1 * (len(verbs) + len(nouns)))
    signal = (f"build verbs={sorted(set(v.lower() for v in verbs))} "
              f"nouns={sorted(set(n.lower() for n in nouns))}")
    return score, round(confidence, 2), signal


def _match_read_query(text: str) -> Optional[Tuple[float, float, str]]:
    signals = _READ_SIGNALS.findall(text)
    if not signals:
        return None
    score = len(signals)
    confidence = min(1.0, 0.6 + 0.1 * score)
    signal = f"read signals={sorted(set(s.lower() for s in signals))}"
    return score, round(confidence, 2), signal


# External-action signals (aci_integration_tasks #4): an outbound verb plus
# an external-tool/destination noun. "email" alone counts as both — "email
# this report to the team" is unambiguous about the action even when the
# recipient still needs clarifying.
_EXTERNAL_VERBS = re.compile(
    r"\b(email|send|notify|post|message|open|create|file|raise)\b", re.IGNORECASE)
_EXTERNAL_NOUNS = re.compile(
    r"\b("
    r"email|e-?mail|slack|channel|ticket|issue|jira|linear|github\s+issue|"
    r"pull\s+request|pr\b|notification|webhook"
    r")\b|#[\w-]+",
    re.IGNORECASE,
)


def _match_external_action(text: str) -> Optional[Tuple[float, float, str]]:
    verbs = _EXTERNAL_VERBS.findall(text)
    nouns = _EXTERNAL_NOUNS.findall(text)
    if not (verbs and nouns):
        return None
    # Score on signal strength only. A prior `+1` bonus made external_action
    # beat schema_design even when schema_design had the stronger signal, so
    # "create target tables for our jira ticketing data" (a schema-design
    # request that merely names a SaaS as its data domain) was misrouted to
    # the ACI approval queue. Arbitration now: stronger raw signal wins; a
    # genuine tie breaks to schema_design (see registration priorities below).
    score = min(len(verbs), 1) + min(len(nouns), 2)
    confidence = min(1.0, 0.65 + 0.1 * (len(verbs) + len(nouns)))
    signal = (f"external verbs={sorted(set(v.lower() for v in verbs))} "
              f"targets={sorted(set(str(n).lower() for n in nouns if n))}")
    return score, round(confidence, 2), signal


# ── Registry ──────────────────────────────────────────────────────────────

_INTENT_REGISTRY: Dict[str, IntentSpec] = {}


def register_intent(spec: IntentSpec) -> None:
    """Register (or replace) an intent handler. Adding a new request type
    is one call here — the classification core never changes."""
    _INTENT_REGISTRY[spec.name] = spec


def registered_intents() -> List[IntentSpec]:
    return sorted(_INTENT_REGISTRY.values(), key=lambda s: -s.priority)


def unregister_intent(name: str) -> None:
    _INTENT_REGISTRY.pop(name, None)


# Built-ins, by tie-break priority (higher wins on equal score):
#   schema_design (20) > external_action (10) > read_query (0).
# schema_design beats read_query on ties ("show me how to create a table") so
# the consequential-but-gated path wins over a silently-wrong SELECT.
# schema_design also beats external_action on ties: when a "create" request
# names both a schema object AND an external tool ("create target tables for
# our jira data"), the schema object is the intent and the tool is just the
# data domain — a genuinely outbound request ("open a github issue…",
# "post to #ops") uses a non-build verb, so external_action still wins it
# outright on score, not on the tie-break.
register_intent(IntentSpec(
    name="schema_design", matcher=_match_schema_design,
    handler="agentic_dba_engine", priority=20,
))
register_intent(IntentSpec(
    name="external_action", matcher=_match_external_action,
    handler="aci_client_service", priority=10,
))
register_intent(IntentSpec(
    name="read_query", matcher=_match_read_query,
    handler="nl2sql", priority=0,
))


def classify_intent(question: str) -> IntentClassification:
    """Classify one AskData question against every registered intent.
    Deterministic; no LLM, no I/O. Highest score wins; ties break by
    priority; nothing matching → ambiguous."""
    text = (question or "").strip()
    if not text:
        return IntentClassification("ambiguous", 0.0, "empty question")

    best: Optional[Tuple[float, int, IntentSpec, float, str]] = None
    for spec in registered_intents():
        result = spec.matcher(text)
        if result is None:
            continue
        score, confidence, signal = result
        key = (score, spec.priority)
        if best is None or key > (best[0], best[1]):
            best = (score, spec.priority, spec, confidence, signal)

    if best is None:
        return IntentClassification("ambiguous", 0.3, "no strong build or read signal")

    _, _, spec, confidence, signal = best
    return IntentClassification(spec.name, confidence, signal, handler=spec.handler)
