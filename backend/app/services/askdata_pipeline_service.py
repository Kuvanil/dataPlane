"""Conversational NL-to-SQL pipeline for AskData Bot (ADB-T1/T2/T3/T5).

Grounds generation in the persisted Schema Intel catalog (falls back to
live schema introspection if the connection hasn't been scanned yet — see
_ground_schema), reuses NL2SQLService for the actual generation logic
(Ollama-or-template — shared with Query Studio's legacy NL2SQL surface,
not duplicated here), then enforces read-only execution via
statement_classifier (also shared with Query Studio: AskData must NEVER
write, unlike Query Studio's gated write path) and masks PII columns for
the viewer role using SecurityService's existing keyword classifier.

Conversation context (ADB-T5) is folded into the question text sent to
NL2SQLService.generate_sql rather than passed as a separate parameter —
that function doesn't have a history parameter, and this is the smallest
way to give the LLM path prior turns without forking it. Known tradeoff:
generate_sql's fast-path template matching (`pattern in question.lower()`)
also sees the history-prefixed text, so if a *prior* turn happened to
contain a fast-path phrase like "show all tables", a fresh question could
misfire down that path. Judged low-risk (those are quite specific idioms a
user wouldn't casually restate) rather than worth forking the shared
generation function.

Summarization is deterministic (row-count / single-value framing), not
another LLM call — keeps this path fast and testable, matching Autopilot's
precedent of avoiding LLM calls where a rule-based answer is sufficient.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.connection import DBConnection
from app.services.nl2sql_service import NL2SQLService
from app.services.schema_catalog_service import SchemaCatalogService
from app.services.schema_service import SchemaService, get_connector
from app.services.security_service import SecurityService
from app.services.statement_classifier import StatementType, classify

logger = logging.getLogger(__name__)

# Roles that get PII columns redacted in results — mirrors the "viewer is
# the most-restricted role" convention already established for the
# dashboard (viewer role masking).
PII_MASK_ROLES = {"viewer"}
MAX_HISTORY_MESSAGES = 6


def _ground_schema(db: Session, connection: DBConnection) -> Tuple[Dict[str, Any], bool]:
    """Returns (schema_context, grounded).

    grounded=False means the connection hasn't been scanned into the Schema
    Intel catalog yet, so this fell back to live introspection.
    """
    catalog_tables = SchemaCatalogService.get_catalog(db, connection.id)
    if catalog_tables:
        schema = {
            t.table_name: [
                {
                    "name": c.column_name,
                    "type": c.data_type,
                    "nullable": c.nullable,
                    "primary_key": c.is_primary_key,
                }
                for c in t.columns
            ]
            for t in catalog_tables
        }
        return schema, True
    try:
        return SchemaService.get_full_schema(connection), False
    except Exception as exc:
        logger.warning("AskData: live schema fallback failed for connection %s: %s", connection.id, exc)
        return {}, False


def _augment_with_history(question: str, history: List[Dict[str, str]]) -> str:
    if not history:
        return question
    recent = history[-MAX_HISTORY_MESSAGES:]
    context_lines = [f"{h['role']}: {h['content']}" for h in recent]
    return (
        "Given this recent conversation:\n" + "\n".join(context_lines) +
        f"\n\nNow answer this follow-up question: {question}"
    )


def _pii_columns(schema: Dict[str, Any], tables_referenced: Optional[List[str]]) -> List[str]:
    tables = tables_referenced or list(schema.keys())
    pii_cols: List[str] = []
    for t in tables:
        for col in schema.get(t, []):
            name = col["name"] if isinstance(col, dict) else str(col)
            if SecurityService.classify_column(name).get("level") == "High":
                pii_cols.append(name)
    return pii_cols


def _summarize_report(report_type: str, results: Any) -> Optional[str]:
    if report_type == "pii_scan":
        n = len(results) if isinstance(results, list) else 0
        return f"Found {n} potentially sensitive column(s)."
    if report_type == "health":
        score = (results or {}).get("health_score")
        return f"Database health score: {score}%." if score is not None else None
    return None


def _summarize_rows(rows: List[Dict[str, Any]]) -> str:
    n = len(rows)
    if n == 0:
        return "No rows matched your question."
    if n == 1 and len(rows[0]) == 1:
        return f"The answer is {next(iter(rows[0].values()))}."
    return f"Found {n} row{'s' if n != 1 else ''}."


def ask(
    db: Session,
    connection: DBConnection,
    question: str,
    role: str,
    history: List[Dict[str, str]],
) -> Dict[str, Any]:
    """Run one conversational turn: ground, generate, classify, execute, mask, summarize."""
    schema, grounded = _ground_schema(db, connection)
    result: Dict[str, Any] = {
        "sql": None, "grounded": grounded, "confidence": 0, "method": "none",
        "executed": False, "columns": [], "rows": [], "row_count": 0,
        "masked_columns": [], "summary": None, "warnings": [], "error": None,
    }
    if not schema:
        result["error"] = "No schema available for this connection — try scanning it first."
        return result

    augmented = _augment_with_history(question, history)
    gen = NL2SQLService.generate_sql(augmented, schema, connection.type)
    result["sql"] = gen.get("sql")
    result["confidence"] = gen.get("confidence", 0)
    result["method"] = gen.get("method", "unknown")

    if gen.get("blocked"):
        result["error"] = gen.get("reason", "Query blocked for safety.")
        return result

    # Pre-computed report types (health/pii_scan) aren't a SQL statement to
    # execute — they're already the answer.
    if gen.get("report_type"):
        rows = gen.get("results")
        result["executed"] = True
        result["rows"] = rows if isinstance(rows, list) else []
        result["row_count"] = len(result["rows"])
        result["summary"] = _summarize_report(gen["report_type"], rows)
        return result

    sql = gen.get("sql") or ""
    classified = classify(sql)
    if classified.type != StatementType.SELECT:
        result["error"] = "Generated SQL was not a read-only SELECT — refusing to execute for safety."
        result["warnings"].append(f"Classified as {classified.type.value}.")
        return result

    connector = get_connector(connection)
    try:
        exec_result = NL2SQLService.execute_safe_query(connector, sql)
    finally:
        connector.close()

    if exec_result.get("error"):
        result["error"] = exec_result["error"]
        return result

    rows = exec_result.get("results", [])
    masked_columns = _pii_columns(schema, classified.tables_referenced) if role in PII_MASK_ROLES else []
    if masked_columns and rows:
        rows = [
            {k: ("***REDACTED***" if k in masked_columns else v) for k, v in row.items()}
            for row in rows
        ]

    result["executed"] = True
    result["columns"] = list(rows[0].keys()) if rows else []
    result["rows"] = rows
    result["row_count"] = len(rows)
    result["masked_columns"] = masked_columns
    result["summary"] = _summarize_rows(rows)
    return result
