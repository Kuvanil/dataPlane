"""Pipeline Service.

Orchestrates a synchronous `source -> ai_matcher -> target` pipeline:

    1. Validate the graph (nodes + edges).
    2. Resolve DB connections from the registry.
    3. Extract full schemas for source and target.
    4. Run AI matching (if an ai_matcher node is present) to produce
       table-level mappings with column-level detail.
    5. Translate the table/column mappings into mapping rules and ask
       ``SchemaMapperService.generate_migration_sql`` for DDL/DML.
    6. Return a result envelope consumable by the Visual Transformation
       Studio UI.
"""

import os
import sqlite3
from collections import deque
from typing import Any, Dict, List, Optional

from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.services.ai_service import AIService
from app.services.schema_mapper_service import SchemaMapperService
from app.services.schema_service import SchemaService


PIPELINE_NODE_TYPES = {"source", "ai_matcher", "target"}
CONFIDENCE_THRESHOLD = 50


class PipelineService:
    """Synchronous pipeline executor."""

    @staticmethod
    def execute_pipeline(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Execute a `source -> ai_matcher -> target` pipeline and return the result.

        Parameters
        ----------
        nodes : list of dict
            Pipeline node definitions. Each node must have an ``id`` and ``type``
            (one of ``source``, ``ai_matcher``, ``target``). ``source`` and
            ``target`` nodes must include ``config.connection_id``.
        edges : list of dict
            Pipeline edge definitions. Each edge must have ``source`` and
            ``target`` fields referencing node ids.

        Returns
        -------
        dict
            Result envelope (see module docstring).
        """
        source_node, target_node, ai_matcher_node = PipelineService._validate_graph(nodes, edges)

        source_config = (source_node.get("config") or {})
        target_config = (target_node.get("config") or {})
        source_id = source_config.get("connection_id")
        target_id = target_config.get("connection_id")

        # Defensive: the validators above already raised, but keep the type
        # narrow for the type-checker / IDE.
        if not isinstance(source_id, int) or source_id <= 0:
            raise ValueError("Source node must have a connection_id configured")
        if not isinstance(target_id, int) or target_id <= 0:
            raise ValueError("Target node must have a connection_id configured")

        source_conn, target_conn = PipelineService._load_connections(source_id, target_id)

        source_schema = SchemaService.get_full_schema(source_conn)
        target_schema = SchemaService.get_full_schema(target_conn)

        # ── On-the-fly target creation (empty SQLite target) ────────
        # When the target is SQLite and its schema is empty, synthesise
        # an identity target schema from the source and generate CREATE
        # TABLE DDL directly. Source must also be SQLite.
        on_the_fly_ddl: List[str] = []
        used_identity_matching = False
        if (target_conn.type or "").lower() == "sqlite" and not target_schema:
            if (source_conn.type or "").lower() != "sqlite":
                raise ValueError("On-the-fly target creation requires the source to be SQLite")
            synthetic_target_schema, on_the_fly_ddl = PipelineService._create_target_on_the_fly(
                source_schema, target_conn
            )
            target_schema = synthetic_target_schema
            used_identity_matching = True

        if used_identity_matching:
            # Freshly-created target mirrors the source one-to-one.
            table_mappings, unmatched_source, unmatched_target = PipelineService._run_identity_matching(
                source_schema, target_schema
            )
        elif ai_matcher_node is not None:
            table_mappings, unmatched_source, unmatched_target = PipelineService._run_ai_matching(
                source_schema, target_schema
            )
        else:
            table_mappings, unmatched_source, unmatched_target = [], [], list(target_schema.keys())

        mapping_rules = PipelineService._build_mapping_rules(table_mappings)
        migration_sql = SchemaMapperService.generate_migration_sql(
            mappings=mapping_rules,
            target_db_type="sqlite",
        )

        # Prepend the on-the-fly CREATE TABLE DDL when applicable.
        if on_the_fly_ddl:
            existing_ddl = list(migration_sql.get("ddl", []))
            existing_dml = list(migration_sql.get("dml", []))
            existing_warnings = list(migration_sql.get("warnings", []))
            migration_sql = {
                "ddl": list(on_the_fly_ddl) + existing_ddl,
                "dml": existing_dml,
                "warnings": existing_warnings,
                "total_statements": len(on_the_fly_ddl)
                + len(existing_ddl)
                + len(existing_dml),
            }

        rows_copied: Dict[str, int] = {}
        if on_the_fly_ddl:
            rows_copied = PipelineService._execute_target_migration(
                source_conn, target_conn, table_mappings, on_the_fly_ddl
            )

        return {
            "status": "success",
            "source": source_conn.name,
            "target": target_conn.name,
            "source_connection_id": source_id,
            "target_connection_id": target_id,
            "table_mappings": table_mappings,
            "unmatched_source": unmatched_source,
            "unmatched_target": unmatched_target,
            "migration_sql": migration_sql,
            "rows_copied": rows_copied,
            "total_rows_copied": sum(rows_copied.values()),
        }

    # ── Graph validation ───────────────────────────────────────

    @staticmethod
    def _validate_graph(
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
    ):
        """Validate nodes + edges. Returns (source_node, target_node, ai_matcher_node)."""

        if not isinstance(nodes, list):
            raise ValueError("Pipeline nodes must be a list")
        if not isinstance(edges, list):
            raise ValueError("Pipeline edges must be a list")

        for node in nodes:
            node_type = node.get("type") if isinstance(node, dict) else None
            if node_type not in PIPELINE_NODE_TYPES:
                raise ValueError(f"Unknown node type: {node_type}")

        source_nodes = [n for n in nodes if n.get("type") == "source"]
        target_nodes = [n for n in nodes if n.get("type") == "target"]
        ai_matcher_nodes = [n for n in nodes if n.get("type") == "ai_matcher"]

        if len(source_nodes) == 0:
            raise ValueError("Pipeline must contain a source node")
        if len(source_nodes) > 1:
            raise ValueError("Pipeline must contain exactly one source node")
        if len(target_nodes) == 0:
            raise ValueError("Pipeline must contain a target node")
        if len(target_nodes) > 1:
            raise ValueError("Pipeline must contain exactly one target node")
        if len(ai_matcher_nodes) > 1:
            raise ValueError("Pipeline must contain at most one ai_matcher node")

        source_node = source_nodes[0]
        target_node = target_nodes[0]
        ai_matcher_node = ai_matcher_nodes[0] if ai_matcher_nodes else None

        # Validate connection_id presence and shape.
        source_config = source_node.get("config") or {}
        target_config = target_node.get("config") or {}

        source_conn_id = source_config.get("connection_id") if isinstance(source_config, dict) else None
        target_conn_id = target_config.get("connection_id") if isinstance(target_config, dict) else None

        if not isinstance(source_conn_id, int) or isinstance(source_conn_id, bool) or source_conn_id <= 0:
            raise ValueError("Source node must have a connection_id configured")
        if not isinstance(target_conn_id, int) or isinstance(target_conn_id, bool) or target_conn_id <= 0:
            raise ValueError("Target node must have a connection_id configured")

        # Build adjacency list from edges and validate reachability.
        adjacency = PipelineService._build_adjacency(edges, nodes)
        if not PipelineService._has_path(adjacency, source_node["id"], target_node["id"]):
            raise ValueError("Source and target are not connected in the pipeline graph")

        # If an ai_matcher is present, it must lie on the source → target path.
        if ai_matcher_node is not None:
            matcher_id = ai_matcher_node["id"]
            on_path = PipelineService._has_path(adjacency, source_node["id"], matcher_id) and \
                PipelineService._has_path(adjacency, matcher_id, target_node["id"])
            if not on_path:
                raise ValueError(
                    "AI matcher node must lie on the path between source and target"
                )

        return source_node, target_node, ai_matcher_node

    @staticmethod
    def _build_adjacency(
        edges: List[Dict[str, Any]],
        nodes: List[Dict[str, Any]],
    ) -> Dict[str, List[str]]:
        """Build a node-id → [neighbor-ids] adjacency list."""
        adjacency: Dict[str, List[str]] = {n["id"]: [] for n in nodes if isinstance(n, dict) and n.get("id")}
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            src = edge.get("source")
            tgt = edge.get("target")
            if src is None or tgt is None:
                continue
            adjacency.setdefault(src, []).append(tgt)
        return adjacency

    @staticmethod
    def _has_path(adjacency: Dict[str, List[str]], src: str, tgt: str) -> bool:
        """Breadth-first search: is there a directed path from ``src`` to ``tgt``?"""
        if src == tgt:
            return True
        visited = {src}
        queue = deque([src])
        while queue:
            current = queue.popleft()
            for neighbor in adjacency.get(current, []):
                if neighbor == tgt:
                    return True
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        return False

    # ── DB connections ─────────────────────────────────────────

    @staticmethod
    def _load_connections(source_id: int, target_id: int):
        """Load ``DBConnection`` rows for source and target. Raises ValueError if missing."""
        db = SessionLocal()
        try:
            source_conn = db.query(DBConnection).filter(DBConnection.id == source_id).first()
            if source_conn is None:
                raise ValueError(f"Connection {source_id} not found")

            target_conn = db.query(DBConnection).filter(DBConnection.id == target_id).first()
            if target_conn is None:
                raise ValueError(f"Connection {target_id} not found")

            # Detach from the session so callers can use the rows after `db.close()`.
            db.refresh(source_conn)
            db.refresh(target_conn)
            return source_conn, target_conn
        finally:
            db.close()

    # ── AI matching ────────────────────────────────────────────

    @staticmethod
    def _run_ai_matching(
        source_schema: Dict[str, List[Dict[str, Any]]],
        target_schema: Dict[str, List[Dict[str, Any]]],
    ):
        """For each source table, find the best target table via column-level confidence.

        Returns ``(table_mappings, unmatched_source, unmatched_target)``.
        """
        # Graceful handling: empty schema → empty result, no error.
        if not source_schema or not target_schema:
            return [], list(source_schema.keys()), list(target_schema.keys())

        matched_target_tables: set = set()
        table_mappings: List[Dict[str, Any]] = []
        unmatched_source: List[str] = []

        for src_table, src_cols in source_schema.items():
            best_target_table: Optional[str] = None
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

            if best_target_table is not None and best_confidence >= CONFIDENCE_THRESHOLD:
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

        return table_mappings, unmatched_source, unmatched_target

    # ── Mapping rules for SchemaMapperService ─────────────────

    @staticmethod
    def _build_mapping_rules(table_mappings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Translate AI-matched table mappings into SchemaMapperService rules."""
        rules: List[Dict[str, Any]] = []
        for mapping in table_mappings:
            details = mapping.get("details") or {}
            matches = details.get("matches", []) or []
            src_table = mapping.get("source_table")
            tgt_table = mapping.get("target_table")

            for match in matches:
                src_col = match.get("source")
                tgt_col = match.get("target")
                if not src_col or not tgt_col:
                    continue
                rules.append(
                    {
                        "source_column": src_col,
                        "source_table": src_table,
                        "target_column": tgt_col,
                        "target_table": tgt_table,
                        "transform": "direct",
                    }
                )

        return rules

    # ── On-the-fly target creation ──────────────────────────────

    @staticmethod
    def _create_target_on_the_fly(
        source_schema: Dict[str, List[Dict[str, Any]]],
        target_conn: DBConnection,
    ):
        """
        Build a synthetic identity target schema from ``source_schema`` and
        generate ``CREATE TABLE IF NOT EXISTS`` statements for each table.

        Returns ``(synthetic_target_schema, create_table_statements)``.
        The synthetic schema mirrors the source column-for-column (same
        names, same types) so downstream matching can use identity rules.
        """
        synthetic_target_schema: Dict[str, List[Dict[str, Any]]] = {}
        create_table_statements: List[str] = []

        for src_table, src_cols in source_schema.items():
            # Mirror the column list as-is.
            synthetic_target_schema[src_table] = list(src_cols)

            column_defs: List[str] = []
            for col in src_cols:
                col_name = col.get("name")
                if not col_name:
                    continue
                col_type = (col.get("type") or "TEXT").strip() or "TEXT"
                column_defs.append(f"{col_name} {col_type}")

            if column_defs:
                ddl = (
                    f"CREATE TABLE IF NOT EXISTS {src_table} (\n"
                    + ",\n".join(f"  {d}" for d in column_defs)
                    + "\n);"
                )
            else:
                ddl = f"CREATE TABLE IF NOT EXISTS {src_table} ();"
            create_table_statements.append(ddl)

        return synthetic_target_schema, create_table_statements

    # ── Target migration execution ──────────────────────────────

    @staticmethod
    def _execute_target_migration(
        source_conn: DBConnection,
        target_conn: DBConnection,
        table_mappings: List[Dict[str, Any]],
        create_table_statements: List[str],
    ) -> Dict[str, int]:
        """Execute CREATE TABLE statements and copy rows from source to target SQLite."""
        source_config = source_conn.config or {}
        target_config = target_conn.config or {}
        source_path = source_config.get("path")
        target_path = target_config.get("path")

        if not source_path or not target_path:
            raise ValueError("SQLite connection config must include 'path'")
        if not os.path.exists(source_path):
            raise ValueError(f"Source SQLite file not found: {source_path}")

        try:
            source_db = sqlite3.connect(source_path)
            source_db.row_factory = sqlite3.Row
            target_db = sqlite3.connect(target_path)

            source_cur = source_db.cursor()
            target_cur = target_db.cursor()

            # Create target tables
            for ddl in create_table_statements:
                target_cur.execute(ddl)

            rows_copied: Dict[str, int] = {}
            for mapping in table_mappings:
                src_table = mapping.get("source_table")
                tgt_table = mapping.get("target_table")
                if not src_table or not tgt_table:
                    continue

                source_cur.execute(f"SELECT * FROM {src_table}")
                rows = source_cur.fetchall()
                if not rows:
                    rows_copied[tgt_table] = 0
                    continue

                column_names = [desc[0] for desc in source_cur.description]
                col_list = ", ".join(column_names)
                placeholders = ", ".join(["?"] * len(column_names))

                target_cur.executemany(
                    f"INSERT INTO {tgt_table} ({col_list}) VALUES ({placeholders})",
                    [tuple(row) for row in rows]
                )
                rows_copied[tgt_table] = len(rows)

            target_db.commit()
            return rows_copied
        except Exception as e:
            raise ValueError(f"Failed to migrate data: {e}")
        finally:
            try:
                source_db.close()
            except Exception:
                pass
            try:
                target_db.close()
            except Exception:
                pass

    # ── Identity matching ───────────────────────────────────────

    @staticmethod
    def _run_identity_matching(
        source_schema: Dict[str, List[Dict[str, Any]]],
        target_schema: Dict[str, List[Dict[str, Any]]],
    ):
        """
        Identity matching: every source table that exists in the target
        schema matches itself with 100% confidence; every column maps to
        itself (direct transform).

        Returns ``(table_mappings, unmatched_source, unmatched_target)``
        with the same shape as ``_run_ai_matching`` so downstream
        consumers (``_build_mapping_rules``,
        ``SchemaMapperService.generate_migration_sql``) work unchanged.
        """
        if not source_schema or not target_schema:
            return [], list(source_schema.keys()), list(target_schema.keys())

        matched_targets: set = set()
        table_mappings: List[Dict[str, Any]] = []
        unmatched_source: List[str] = []

        for src_table, src_cols in source_schema.items():
            tgt_cols = target_schema.get(src_table)
            if tgt_cols is None:
                unmatched_source.append(src_table)
                continue

            tgt_col_names = {c.get("name") for c in tgt_cols if c.get("name")}
            matches: List[Dict[str, Any]] = []
            for col in src_cols:
                col_name = col.get("name")
                if not col_name:
                    continue
                if col_name in tgt_col_names:
                    matches.append(
                        {
                            "source": col_name,
                            "target": col_name,
                            "confidence": 100,
                            "reason": "Identity match (on-the-fly target)",
                        }
                    )

            table_mappings.append(
                {
                    "source_table": src_table,
                    "target_table": src_table,
                    "confidence": 100,
                    "details": {"matches": matches, "identity": True},
                }
            )
            matched_targets.add(src_table)

        unmatched_target = [
            t for t in target_schema.keys() if t not in matched_targets
        ]

        return table_mappings, unmatched_source, unmatched_target
