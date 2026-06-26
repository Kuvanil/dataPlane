"""Celery tasks wrapping synchronous AI / schema-mapping services.

Each task accepts only serializable inputs (ints, strings, dicts, JSON strings)
and creates its own short-lived DB session via SessionLocal.
"""

import json
from typing import Any, Dict, List

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.services.ai_service import AIService
from app.services.nl2sql_service import NL2SQLService
from app.services.schema_mapper_service import SchemaMapperService
from app.services.schema_service import SchemaService


def _get_schema_for_connection(connection_id: int) -> Dict[str, Any]:
    """Helper: load a DBConnection by id, fetch its schema, close the session."""
    db = SessionLocal()
    try:
        conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
        if conn is None:
            raise ValueError(f"DBConnection id={connection_id} not found")
        return SchemaService.get_full_schema(conn)
    finally:
        db.close()


@celery_app.task(name="app.tasks.ai_tasks.match_schemas_task", bind=True)
def match_schemas_task(
    self,
    source_id: int,
    target_id: int,
    source_table: str,
    target_table: str,
) -> Dict[str, Any]:
    """Async wrapper around AIService.match_schemas."""
    db = SessionLocal()
    try:
        source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
        target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

        if not source_conn or not target_conn:
            raise ValueError(
                f"Connection not found (source_id={source_id}, target_id={target_id})"
            )

        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        if source_table not in source_schema:
            raise ValueError(
                f"Table '{source_table}' not found in source '{source_conn.name}'"
            )
        if target_table not in target_schema:
            raise ValueError(
                f"Table '{target_table}' not found in target '{target_conn.name}'"
            )

        match_results = AIService.match_schemas(
            source_name=source_table,
            source_schema=source_schema[source_table],
            target_name=target_table,
            target_schema=target_schema[target_table],
        )
        return {
            "source": source_conn.name,
            "target": target_conn.name,
            "source_table": source_table,
            "target_table": target_table,
            "suggestions": match_results,
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.ai_tasks.nl2sql_task", bind=True)
def nl2sql_task(
    self,
    connection_id: int,
    question: str,
    execute: bool = False,
) -> Dict[str, Any]:
    """Async wrapper around NL2SQLService.generate_sql.

    `execute` is accepted for API compatibility but execution is intentionally
    out of scope for the async worker (callers should run the returned SQL
    through the synchronous /api/v1/query endpoint).
    """
    db = SessionLocal()
    try:
        conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
        if conn is None:
            raise ValueError(f"DBConnection id={connection_id} not found")

        schema_context = SchemaService.get_full_schema(conn)
        sql_result = NL2SQLService.generate_sql(
            natural_query=question,
            schema_context=schema_context,
            db_type=conn.type,
        )

        return {
            "connection": conn.name,
            "question": question,
            "sql_result": sql_result,
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.ai_tasks.generate_migration_task", bind=True)
def generate_migration_task(
    self,
    mappings_json: str,
    target_db_type: str = "sqlite",
) -> Dict[str, Any]:
    """Async wrapper around SchemaMapperService.generate_migration_sql.

    `mappings_json` is a JSON string so the task stays serializable.
    """
    db = SessionLocal()
    try:
        mappings: List[Dict[str, Any]] = json.loads(mappings_json) if mappings_json else []
        if not isinstance(mappings, list):
            raise ValueError("mappings_json must decode to a list of mapping rules")

        result = SchemaMapperService.generate_migration_sql(
            mappings=mappings,
            target_db_type=target_db_type,
        )
        result["target_db_type"] = target_db_type
        return result
    finally:
        db.close()


@celery_app.task(name="app.tasks.ai_tasks.parse_english_mapping_task", bind=True)
def parse_english_mapping_task(
    self,
    text: str,
    source_schema_json: str,
    target_schema_json: str,
) -> Dict[str, Any]:
    """Async wrapper around SchemaMapperService.parse_english_mapping.

    `source_schema_json` and `target_schema_json` are JSON strings so the
    task only accepts serializable inputs.
    """
    db = SessionLocal()
    try:
        source_schema = json.loads(source_schema_json) if source_schema_json else {}
        target_schema = json.loads(target_schema_json) if target_schema_json else {}

        result = SchemaMapperService.parse_english_mapping(
            text=text,
            source_schema=source_schema,
            target_schema=target_schema,
        )
        return result
    finally:
        db.close()


@celery_app.task(name="app.tasks.ai_tasks.schema_wide_match_task", bind=True)
def schema_wide_match_task(
    self,
    source_id: int,
    target_id: int,
) -> Dict[str, Any]:
    """Schema-wide matcher: iterate ALL source tables against ALL target tables.

    For each source table, score every target table by the maximum column-level
    confidence returned by ``AIService.match_schemas`` and pick the target
    with the highest score. Pairs with confidence >= 50 are considered matched;
    otherwise the source table is reported as unmatched. A target table is
    listed as unmatched only when no source table picked it as its best match.
    """
    if source_id == target_id:
        raise ValueError("Source and target must be different databases")

    db = SessionLocal()
    try:
        source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
        target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()

        if not source_conn or not target_conn:
            raise ValueError("Source or Target Connection not found")

        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        # Graceful handling: if either side has no tables, return empty results
        # rather than raising — callers can still render the empty state.
        if not source_schema or not target_schema:
            return {
                "source": source_conn.name,
                "target": target_conn.name,
                "table_mappings": [],
                "unmatched_source": list(source_schema.keys()) if source_schema else [],
                "unmatched_target": list(target_schema.keys()) if target_schema else [],
                "total_source_tables": len(source_schema) if source_schema else 0,
                "total_target_tables": len(target_schema) if target_schema else 0,
            }

        matched_target_tables: set = set()
        table_mappings: List[Dict[str, Any]] = []
        unmatched_source: List[str] = []

        for src_table, src_cols in source_schema.items():
            best_target_table = None
            best_details: Dict[str, Any] = {}
            best_confidence: float = 0.0

            for tgt_table, tgt_cols in target_schema.items():
                match_result = AIService.match_schemas(
                    source_name=src_table,
                    source_schema=src_cols,
                    target_name=tgt_table,
                    target_schema=tgt_cols,
                )
                matches = match_result.get("matches", []) or []
                if not matches:
                    continue
                max_conf = max(
                    (m.get("confidence", 0) or 0 for m in matches),
                    default=0,
                )
                if max_conf > best_confidence:
                    best_confidence = max_conf
                    best_target_table = tgt_table
                    best_details = match_result

            if best_target_table is not None and best_confidence >= 50:
                table_mappings.append(
                    {
                        "source_table": src_table,
                        "target_table": best_target_table,
                        "confidence": best_confidence,
                        "details": best_details,
                    }
                )
                matched_target_tables.add(best_target_table)
            else:
                unmatched_source.append(src_table)

        unmatched_target = [
            t for t in target_schema.keys() if t not in matched_target_tables
        ]

        return {
            "source": source_conn.name,
            "target": target_conn.name,
            "table_mappings": table_mappings,
            "unmatched_source": unmatched_source,
            "unmatched_target": unmatched_target,
            "total_source_tables": len(source_schema),
            "total_target_tables": len(target_schema),
        }
    finally:
        db.close()
