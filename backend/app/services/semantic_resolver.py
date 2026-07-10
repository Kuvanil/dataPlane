"""Semantic query resolution engine (DP-SEM-001, SEM-T3, Task #5).

Given a metric version's definition + lineage, produces an executable
parameterized SQL query against the physical schema (Schema Intel
catalog tables). Mirrors the pattern established by
app/services/transformation_grammar.compile_sql — returns (sql,
placeholders) so the caller binds and executes.

Inputs:
- metric_version_id (int): which published metric definition to resolve.
  Drafts are rejected (resolution only runs against published versions
  per FR3).
- dimensions (list[str]): which dimension columns to group by at query
  time. Optional — if empty, the query returns aggregate values only.
- filters (dict): key-value pairs applied as WHERE conditions at query
  time. Optional.

Algorithm:
1. Load the metric definition (must be status='published').
2. Parse the definition via semantic_definition.parse() — raises
   GrammarError on bad input.
3. Load the lineage rows (catalog_column_id + role). The lineage
   tells us which physical columns the metric reads. role determines
   whether a column is a measure, dimension, time, or join_key.
4. Walk the catalog_columns → catalog_tables to identify the physical
   tables involved.
5. Walk the join config from the definition to connect tables.
6. Build the SELECT / FROM / JOIN / WHERE / GROUP BY SQL using the
   grammar's compile_sql helper, replacing placeholder entity/measure
   names with the resolved catalog column references.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.schema_catalog import CatalogColumn, CatalogTable
from app.models.semantic import (
    SemanticLineage,
    SemanticMetricDefinition,
)
from app.services.semantic_definition import compile_sql, parse

logger = logging.getLogger(__name__)


class ResolutionError(ValueError):
    """Raised when a metric can't be resolved to a physical query.

    Examples: metric not found, no lineage, lineage points to columns
    in tables the definition doesn't reference, etc.
    """


def resolve(
    db: Session,
    metric_version_id: int,
    *,
    dimensions: Optional[List[str]] = None,
    filters: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Any]]:
    """Resolve a published metric version to a parameterized SQL query.

    Returns (sql, placeholders). Caller binds placeholders into a DB
    connection and executes.
    """
    if dimensions is None:
        dimensions = []
    if filters is None:
        filters = {}

    # 1. Load the metric version
    m = (
        db.query(SemanticMetricDefinition)
        .filter(SemanticMetricDefinition.id == metric_version_id)
        .first()
    )
    if not m:
        raise ResolutionError(f"metric {metric_version_id} not found")
    if m.status != "published":
        raise ResolutionError(
            f"metric {m.name} v{m.version_number} is '{m.status}'; "
            f"only published metrics can be resolved"
        )

    # 2. Parse the definition
    parsed = parse(m.definition)

    # 3. Load lineage
    lineage = list(m.lineage or [])
    if not lineage:
        raise ResolutionError(
            f"metric {m.name} v{m.version_number} has no lineage; "
            f"bind at least one physical column before resolving"
        )

    # 4. Walk lineage → catalog_columns → catalog_tables
    catalog_columns_by_id: Dict[int, CatalogColumn] = {}
    catalog_tables_by_id: Dict[int, CatalogTable] = {}
    for ln in lineage:
        if ln.catalog_column_id is None:
            continue  # broken lineage; catalog column deleted
        col = (
            db.query(CatalogColumn)
            .filter(CatalogColumn.id == ln.catalog_column_id)
            .first()
        )
        if not col:
            continue
        catalog_columns_by_id[col.id] = col
        if col.table_id not in catalog_tables_by_id:
            table = (
                db.query(CatalogTable)
                .filter(CatalogTable.id == col.table_id)
                .first()
            )
            if table:
                catalog_tables_by_id[table.id] = table

    if not catalog_tables_by_id:
        raise ResolutionError(
            f"metric {m.name} v{m.version_number} lineage references "
            f"columns that no longer exist; re-bind lineage"
        )

    # 5. Substitute the entity name in the parsed definition with the
    # actual table name from lineage. The grammar uses entity as the
    # table identifier; here we resolve entity -> catalog_table.name.
    entity_table = _pick_entity_table(parsed["entity"], catalog_tables_by_id.values())
    if entity_table is None:
        raise ResolutionError(
            f"entity '{parsed['entity']}' has no physical table in "
            f"lineage; bind it to a catalog table before resolving"
        )

    # 6. Find the measure column from lineage (role='measure')
    measure_col = _pick_role_column(lineage, catalog_columns_by_id, role="measure")
    if measure_col is None:
        raise ResolutionError(
            f"metric {m.name} v{m.version_number} lineage has no measure "
            f"column (role='measure'); bind one before resolving"
        )

    # 7. Build the SQL via the grammar compiler, swapping entity /
    # measure for resolved catalog references.
    resolved_definition = dict(parsed)
    resolved_definition["entity"] = entity_table.table_name
    # The grammar expects entity.measure to be a column name; substitute
    # the resolved physical column.
    resolved_definition["measure"] = measure_col.column_name

    # 8. Map additional lineage columns into the filter set if the
    # caller didn't supply them explicitly — common case is "all rows".
    # We don't auto-add lineage dimension columns; the caller passes the
    # dimensions they want to group by.

    # 9. Compile.
    placeholders: List[Any] = []
    sql = compile_sql(resolved_definition, placeholders)

    # 10. Apply caller-supplied filters (key=value pairs on physical
    # column names). The grammar's filter syntax handles individual
    # filters; this adds a batch WHERE for the common case.
    extra_filters = _build_extra_filters(filters)
    if extra_filters:
        sql, placeholders = _append_where(sql, placeholders, extra_filters)

    return sql, placeholders


def _pick_entity_table(
    entity_name: str, tables: List[CatalogTable],
) -> Optional[CatalogTable]:
    """Match the definition's entity name to a catalog table by name."""
    for t in tables:
        if t.table_name == entity_name:
            return t
    return None


def _pick_role_column(
    lineage: List[SemanticLineage],
    catalog_columns_by_id: Dict[int, CatalogColumn],
    *,
    role: str,
) -> Optional[CatalogColumn]:
    """Find the first lineage row with the given role whose column still
    exists in the catalog."""
    for ln in lineage:
        if ln.role != role:
            continue
        if ln.catalog_column_id is None:
            continue
        col = catalog_columns_by_id.get(ln.catalog_column_id)
        if col is not None:
            return col
    return None


def _build_extra_filters(
    filters: Dict[str, Any],
) -> List[Tuple[str, str, Any]]:
    """Translate {column: value} filters into the grammar's filter
    triple format: [(column, op, value)] with op='='."""
    out = []
    for col, val in filters.items():
        out.append((col, "=", val))
    return out


def _append_where(
    sql: str,
    placeholders: List[Any],
    extra_filters: List[Tuple[str, str, Any]],
) -> Tuple[str, List[Any]]:
    """Append extra WHERE clauses to SQL emitted by compile_sql.

    compile_sql's output already ends with WHERE ... if it has any
    filters from the definition; if not, this starts a new WHERE.
    """
    if not extra_filters:
        return sql, placeholders
    clauses = []
    for col, op, val in extra_filters:
        if op != "=":
            raise ResolutionError(
                f"only '=' is supported for caller-supplied filters; got {op!r}"
            )
        placeholders.append(val)
        clauses.append(f"{col} = %s")
    if " WHERE " in sql:
        return sql + " AND " + " AND ".join(clauses), placeholders
    return sql + " WHERE " + " AND ".join(clauses), placeholders
