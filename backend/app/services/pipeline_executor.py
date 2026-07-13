"""Pipeline execution engine (Task #3). Consumes a pipeline's pinned
published mapping version and executes E-T-L asynchronously via Celery.

Scope decision (documented, see Pipelines_tasks/03_execution_engine.md):
only ``transformation.kind == "direct"`` field mappings are executed.
``transformation_grammar.compile_sql`` uses an interleaved positional
placeholder scheme (literal values are appended to a shared list at the
exact point a "%s" is emitted, source-column values are not) that is
designed for single-shot query preview, not per-row batch ETL binding.
Rather than build a parallel, harder-to-verify binding scheme for the
data-movement path, non-"direct" transformations fail the run with an
actionable error naming the offending columns instead of moving data
that may be wrong. Direct transformations cover the overwhelming common
case (straight column copy) and are the only path exercised by the
Visual Transformation Studio's legacy executor too.

Only sqlite/postgres/mysql targets support real row movement (matches
which drivers this repo's connectors actually use a DB-API cursor for).
Oracle/JDBC connections fail the run with a clear "not yet supported"
message rather than attempt an unverified code path.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.models.mapping import FieldMapping, MappingVersion
from app.models.pipeline import Pipeline, PipelineRun, PipelineRunStep
from app.services.pipeline_service import PipelineCRUD
from app.services.schema_service import get_connector

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 1000
SUPPORTED_DIALECTS = {"sqlite", "postgres", "mysql"}


class PipelineExecutionError(Exception):
    """Raised for any failure during execute() that should mark the run
    failed with a clear, actionable message (not a raw stack trace)."""


class PipelineExecutor:
    """Executes a pipeline's E-T-L cycle from its pinned mapping version."""

    @staticmethod
    def execute(pipeline_id: int, run_id: int, trigger: str = "manual") -> Dict[str, Any]:
        """Main entry point. Called by the Celery task (app.workers.pipeline_tasks)."""
        db = SessionLocal()
        try:
            pipeline = PipelineCRUD.get_pipeline(db, pipeline_id)
            _update_run_status(db, run_id, "running")

            logger.info(
                "[pipeline] stage=drift_check pipeline_id=%s run_id=%s", pipeline_id, run_id,
            )
            drift = PipelineCRUD.validate_drift(db, pipeline_id, actor="system")
            if drift["has_drift"]:
                _fail_run(db, run_id, f"blocked by schema drift: {drift['message']} "
                                       f"(tables: {', '.join(drift['changed_tables']) or 'unknown'})")
                return {"status": "blocked", "reason": "drift", "detail": drift}

            table_groups = _load_table_mappings(db, pipeline)
            if not table_groups:
                _fail_run(db, run_id, "pinned mapping version has no field mappings to execute")
                return {"status": "failed", "reason": "no_field_mappings"}

            source_conn = db.query(DBConnection).filter(
                DBConnection.id == pipeline.source_connection_id
            ).first()
            target_conn = db.query(DBConnection).filter(
                DBConnection.id == pipeline.target_connection_id
            ).first()
            if not source_conn or not target_conn:
                _fail_run(db, run_id, "source or target connection no longer exists")
                return {"status": "failed", "reason": "connection_not_found"}

            logger.info(
                "[pipeline] stage=extract_transform_load pipeline_id=%s run_id=%s tables=%d",
                pipeline_id, run_id, len(table_groups),
            )
            total_rows = 0
            for group in table_groups:
                total_rows += _execute_table_mapping(db, run_id, source_conn, target_conn, group)

            logger.info(
                "[pipeline] stage=done pipeline_id=%s run_id=%s rows_processed=%d",
                pipeline_id, run_id, total_rows,
            )
            _complete_run(db, run_id, total_rows)
            return {"status": "completed", "rows_processed": total_rows}

        except PipelineExecutionError as exc:
            logger.warning("[pipeline] stage=failed pipeline_id=%s run_id=%s error=%s",
                            pipeline_id, run_id, exc)
            _fail_run(db, run_id, str(exc))
            return {"status": "failed", "error": str(exc)}
        except Exception as exc:
            logger.exception("[pipeline] stage=failed pipeline_id=%s run_id=%s unexpected error",
                              pipeline_id, run_id)
            _fail_run(db, run_id, str(exc))
            return {"status": "failed", "error": str(exc)}
        finally:
            db.close()


# ── Grouping field mappings into per-table E-T-L units ───────────────────

class _TableGroup:
    def __init__(self, source_table: str, target_table: str):
        self.source_table = source_table
        self.target_table = target_table
        self.column_pairs: List[Tuple[str, str]] = []  # (source_column, target_column)
        self.natural_keys: List[str] = []


def _load_table_mappings(db: Session, pipeline: Pipeline) -> List[_TableGroup]:
    """Group the pinned mapping version's field_mappings by (source_table,
    target_table), validating that every edge is a supported "direct"
    single-source mapping. Raises PipelineExecutionError with an
    actionable message if any edge cannot be executed."""
    edges: List[FieldMapping] = (
        db.query(FieldMapping)
        .filter(FieldMapping.version_id == pipeline.mapping_version_id)
        .all()
    )
    groups: Dict[Tuple[str, str], _TableGroup] = {}
    unsupported: List[str] = []

    for edge in edges:
        sources = edge.sources or []
        kind = (edge.transformation or {}).get("kind", "direct")
        if kind != "direct" or len(sources) != 1:
            unsupported.append(f"{edge.target_table}.{edge.target_column} (kind={kind}, sources={len(sources)})")
            continue

        source_table = sources[0].get("table")
        source_column = sources[0].get("column")
        if not source_table or not source_column:
            unsupported.append(f"{edge.target_table}.{edge.target_column} (missing source table/column)")
            continue

        key = (source_table, edge.target_table)
        group = groups.setdefault(key, _TableGroup(source_table, edge.target_table))
        group.column_pairs.append((source_column, edge.target_column))
        if edge.target_is_pk:
            group.natural_keys.append(edge.target_column)

    if unsupported:
        raise PipelineExecutionError(
            "pipeline execution only supports 'direct' single-source column mappings; "
            f"unsupported field mapping(s): {'; '.join(unsupported)}"
        )

    return list(groups.values())


# ── Per-table extract/transform/load ──────────────────────────────────────

def _execute_table_mapping(
    db: Session,
    run_id: int,
    source_conn: DBConnection,
    target_conn: DBConnection,
    group: _TableGroup,
) -> int:
    extract_step = _create_step(db, run_id, "extract")
    transform_step = _create_step(db, run_id, "transform")
    load_step = _create_step(db, run_id, "load")

    try:
        source_dialect = (source_conn.type or "").lower()
        target_dialect = (target_conn.type or "").lower()
        if target_dialect not in SUPPORTED_DIALECTS:
            raise PipelineExecutionError(
                f"target connection type '{target_dialect}' is not yet supported for "
                "pipeline execution (supported: sqlite, postgres, mysql)"
            )

        _complete_step(db, extract_step.id)
        # "Transform" here is validation-only (Decision: direct-only transforms,
        # see module docstring) — the actual column renaming happens in the
        # single extract+load SQL pass below.
        _complete_step(db, transform_step.id)

        rows = _batch_copy(source_conn, target_conn, group)
        _complete_step(db, load_step.id, rows_processed=rows)
        return rows
    except Exception as exc:
        _fail_step(db, load_step.id if load_step.status != "failed" else extract_step.id, str(exc))
        raise PipelineExecutionError(
            f"failed to load {group.source_table} -> {group.target_table}: {exc}"
        ) from exc


def _placeholder(dialect: str) -> str:
    return "?" if dialect == "sqlite" else "%s"


def _quote(dialect: str, identifier: str) -> str:
    if dialect == "sqlite":
        return '"' + identifier.replace('"', '""') + '"'
    if dialect == "mysql":
        return "`" + identifier.replace("`", "``") + "`"
    return '"' + identifier.replace('"', '""') + '"'  # postgres


def _batch_copy(
    source_conn: DBConnection,
    target_conn: DBConnection,
    group: _TableGroup,
) -> int:
    """Extract rows in batches from source, load into target using the
    same column-to-column mapping, upserting on natural keys where the
    target has a declared primary key, or replacing the full table
    otherwise (Decision 2, see task spec)."""
    batch_size = getattr(settings, "PIPELINE_EXEC_BATCH_SIZE", DEFAULT_BATCH_SIZE)
    allow_full_replace = getattr(settings, "PIPELINE_ALLOW_FULL_TABLE_REPLACE", True)

    source_driver = get_connector(source_conn)
    target_driver = get_connector(target_conn)
    source_dialect = (source_conn.type or "").lower()
    target_dialect = (target_conn.type or "").lower()

    use_upsert = len(group.natural_keys) > 0
    if not use_upsert and not allow_full_replace:
        raise PipelineExecutionError(
            f"table '{group.target_table}' has no natural key and "
            "PIPELINE_ALLOW_FULL_TABLE_REPLACE is disabled; add a primary-key "
            "mapping or enable full-table replace"
        )

    try:
        source_handle = source_driver.connect()
        target_handle = target_driver.connect()
        source_cursor = source_handle.cursor()
        target_cursor = target_handle.cursor()

        source_cols = [pair[0] for pair in group.column_pairs]
        target_cols = [pair[1] for pair in group.column_pairs]

        total_rows = 0
        offset = 0
        replaced_once = not use_upsert  # first batch of a replace also DELETEs

        while True:
            select_sql = _build_select_sql(source_dialect, group.source_table, source_cols, batch_size, offset)
            source_cursor.execute(select_sql)
            batch = source_cursor.fetchall()
            if not batch:
                break

            if use_upsert:
                _upsert_batch(target_cursor, target_dialect, group.target_table,
                               target_cols, group.natural_keys, batch)
            else:
                _replace_batch(target_cursor, target_dialect, group.target_table,
                                target_cols, batch, delete_first=not replaced_once)
                replaced_once = True

            total_rows += len(batch)
            offset += batch_size

        target_handle.commit()
        return total_rows
    finally:
        source_driver.close()
        target_driver.close()


def _build_select_sql(dialect: str, table: str, columns: List[str], limit: int, offset: int) -> str:
    q = lambda ident: _quote(dialect, ident)  # noqa: E731
    cols = ", ".join(q(c) for c in columns)
    return f"SELECT {cols} FROM {q(table)} LIMIT {limit} OFFSET {offset}"


def _upsert_batch(cursor, dialect: str, table: str, columns: List[str],
                   natural_keys: List[str], batch: List[tuple]) -> None:
    q = lambda ident: _quote(dialect, ident)  # noqa: E731
    ph = _placeholder(dialect)
    col_list = ", ".join(q(c) for c in columns)
    placeholders = ", ".join([ph] * len(columns))
    update_cols = [c for c in columns if c not in natural_keys]

    if dialect == "mysql":
        update_clause = ", ".join(f"{q(c)}=VALUES({q(c)})" for c in update_cols)
        sql = f"INSERT INTO {q(table)} ({col_list}) VALUES ({placeholders})"
        if update_clause:
            sql += f" ON DUPLICATE KEY UPDATE {update_clause}"
    else:  # sqlite, postgres
        key_list = ", ".join(q(c) for c in natural_keys)
        update_clause = ", ".join(f"{q(c)}=EXCLUDED.{q(c)}" for c in update_cols)
        sql = f"INSERT INTO {q(table)} ({col_list}) VALUES ({placeholders}) ON CONFLICT ({key_list})"
        sql += f" DO UPDATE SET {update_clause}" if update_clause else " DO NOTHING"

    rows = [tuple(row) for row in batch]
    cursor.executemany(sql, rows)


def _replace_batch(cursor, dialect: str, table: str, columns: List[str],
                    batch: List[tuple], delete_first: bool) -> None:
    q = lambda ident: _quote(dialect, ident)  # noqa: E731
    ph = _placeholder(dialect)
    if delete_first:
        cursor.execute(f"DELETE FROM {q(table)}")
    col_list = ", ".join(q(c) for c in columns)
    placeholders = ", ".join([ph] * len(columns))
    sql = f"INSERT INTO {q(table)} ({col_list}) VALUES ({placeholders})"
    rows = [tuple(row) for row in batch]
    cursor.executemany(sql, rows)


# ── Run/Step lifecycle helpers ────────────────────────────────────────────

def _create_step(db: Session, run_id: int, step: str) -> PipelineRunStep:
    s = PipelineRunStep(run_id=run_id, step=step, status="running", started_at=func.now())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _complete_step(db: Session, step_id: int, rows_processed: int = 0) -> None:
    step = db.query(PipelineRunStep).filter(PipelineRunStep.id == step_id).first()
    if step:
        step.status = "succeeded"
        step.finished_at = func.now()
        step.rows_processed = rows_processed
        db.commit()


def _fail_step(db: Session, step_id: int, error: str) -> None:
    step = db.query(PipelineRunStep).filter(PipelineRunStep.id == step_id).first()
    if step and step.status != "failed":
        step.status = "failed"
        step.finished_at = func.now()
        step.error_message = error
        db.commit()


def _update_run_status(db: Session, run_id: int, status: str,
                        rows: Optional[int] = None, error: Optional[str] = None) -> None:
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        return
    run.status = status
    if status == "running" and run.started_at is None:
        run.started_at = func.now()
    if status in ("succeeded", "failed"):
        run.finished_at = func.now()
    if rows is not None:
        run.rows_processed = rows
    if error is not None:
        run.error_message = error
    db.commit()


def _fail_run(db: Session, run_id: int, error: str) -> None:
    _update_run_status(db, run_id, "failed", error=error)


def _complete_run(db: Session, run_id: int, rows: int) -> None:
    _update_run_status(db, run_id, "succeeded", rows=rows)
