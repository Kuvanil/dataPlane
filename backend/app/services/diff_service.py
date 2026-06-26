from typing import List, Dict, Any

class DiffService:
    @staticmethod
    def compare_tables(source_cols: List[Dict[str, Any]], target_cols: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Compares columns of two tables and returns structural diff.
        """
        source_map = {c["name"]: c for c in source_cols}
        target_map = {c["name"]: c for c in target_cols}

        matched = []
        missing_in_target = []
        missing_in_source = []
        type_mismatches = []

        for name, col in source_map.items():
            if name in target_map:
                target_col = target_map[name]
                matched.append(name)
                if col["type"].lower() != target_col["type"].lower():
                    type_mismatches.append({
                        "column": name,
                        "source_type": col["type"],
                        "target_type": target_col["type"]
                    })
            else:
                missing_in_target.append(name)

        for name in target_map.keys():
            if name not in source_map:
                missing_in_source.append(name)

        return {
            "matched": matched,
            "missing_in_target": missing_in_target,
            "missing_in_source": missing_in_source,
            "type_mismatches": type_mismatches,
            "score": len(matched) / max(1, len(source_map)) * 100
        }

    @staticmethod
    def compare_schemas(source_schema: Dict[str, List[Dict[str, Any]]], target_schema: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """
        Compares entire schemas and finds exact table matches and structural diffs.
        """
        source_tables = set(source_schema.keys())
        target_tables = set(target_schema.keys())

        matched_tables = source_tables.intersection(target_tables)
        missing_tables_in_target = list(source_tables - target_tables)
        missing_tables_in_source = list(target_tables - source_tables)

        table_diffs = {}
        for table in matched_tables:
            table_diffs[table] = DiffService.compare_tables(source_schema[table], target_schema[table])

        return {
            "matched_tables": list(matched_tables),
            "missing_tables_in_target": missing_tables_in_target,
            "missing_tables_in_source": missing_tables_in_source,
            "table_diffs": table_diffs
        }

    @staticmethod
    def generate_graph_data(
        source_schema: Dict[str, List[Dict[str, Any]]],
        target_schema: Dict[str, List[Dict[str, Any]]],
        diff_result: Dict[str, Any],
        classifications: Dict[str, Any] = None,
        ai_matches: List[Dict[str, Any]] = None,
        source_name: str = "Source",
        target_name: str = "Target",
    ) -> Dict[str, Any]:
        """
        Convert schema + diff + classification data into a graph-compatible format
        for Neo4j/NetworkX-style visualization on the frontend.
        """
        nodes = []
        edges = []
        annotations = []

        # ── Classification lookup ─────────────────────────────
        cls_lookup = {}
        if classifications:
            for table, cols in classifications.items():
                for c in cols:
                    key = f"{table}.{c['column']}"
                    cls_lookup[key] = c["classification"]

        # ── Source table nodes ────────────────────────────────
        x_source = 100
        y_offset = 80
        for i, (table, cols) in enumerate(source_schema.items()):
            # Table group node
            table_node_id = f"src_{table}"
            has_issues = table in diff_result.get("missing_tables_in_target", [])
            risk_level = "low"

            col_risks = []
            for col in cols:
                cls_info = cls_lookup.get(f"{table}.{col['name']}", {})
                col_risk = cls_info.get("level", "Low")
                col_risks.append(col_risk)

            if "High" in col_risks:
                risk_level = "high"
            elif "Medium" in col_risks:
                risk_level = "medium"

            nodes.append({
                "id": table_node_id,
                "label": table,
                "type": "table",
                "group": "source",
                "database": source_name,
                "x": x_source,
                "y": y_offset * (i + 1),
                "columns": [
                    {
                        "name": c["name"],
                        "type": c.get("type", "?"),
                        "primary_key": c.get("primary_key", False),
                        "nullable": c.get("nullable", True),
                        "classification": cls_lookup.get(f"{table}.{c['name']}", {}),
                    }
                    for c in cols
                ],
                "risk_level": risk_level,
                "has_issues": has_issues,
                "column_count": len(cols),
                "style": {
                    "background": "#1e293b" if not has_issues else "#7f1d1d",
                    "border": (
                        "#ef4444" if risk_level == "high"
                        else "#f59e0b" if risk_level == "medium"
                        else "#22c55e"
                    ),
                },
            })

            if has_issues:
                annotations.append({
                    "node_id": table_node_id,
                    "type": "error",
                    "message": f"Table '{table}' not found in target schema",
                    "severity": "high",
                })

        # ── Target table nodes ────────────────────────────────
        x_target = 600
        for i, (table, cols) in enumerate(target_schema.items()):
            table_node_id = f"tgt_{table}"
            has_issues = table in diff_result.get("missing_tables_in_source", [])

            nodes.append({
                "id": table_node_id,
                "label": table,
                "type": "table",
                "group": "target",
                "database": target_name,
                "x": x_target,
                "y": y_offset * (i + 1),
                "columns": [
                    {
                        "name": c["name"],
                        "type": c.get("type", "?"),
                        "primary_key": c.get("primary_key", False),
                        "nullable": c.get("nullable", True),
                    }
                    for c in cols
                ],
                "risk_level": "low",
                "has_issues": has_issues,
                "column_count": len(cols),
                "style": {
                    "background": "#1e293b" if not has_issues else "#7f1d1d",
                    "border": "#3b82f6" if not has_issues else "#f59e0b",
                },
            })

        # ── Matched table edges ───────────────────────────────
        for table in diff_result.get("matched_tables", []):
            table_diff = diff_result.get("table_diffs", {}).get(table, {})
            score = table_diff.get("score", 0)
            edges.append({
                "source": f"src_{table}",
                "target": f"tgt_{table}",
                "type": "exact_match",
                "label": f"{score:.0f}% match",
                "animated": True,
                "style": {
                    "stroke": "#22c55e" if score > 80 else "#f59e0b" if score > 50 else "#ef4444",
                },
            })

            # Type mismatch annotations
            for tm in table_diff.get("type_mismatches", []):
                annotations.append({
                    "node_id": f"src_{table}",
                    "type": "warning",
                    "message": f"Type mismatch: {tm['column']} ({tm['source_type']} → {tm['target_type']})",
                    "severity": "medium",
                })

        # ── AI-matched edges ──────────────────────────────────
        if ai_matches:
            for match in ai_matches:
                src_tables = [n["id"] for n in nodes if n["group"] == "source"]
                tgt_tables = [n["id"] for n in nodes if n["group"] == "target"]
                if src_tables and tgt_tables:
                    edges.append({
                        "source": src_tables[0],
                        "target": tgt_tables[0],
                        "type": "ai_match",
                        "label": f"AI: {match.get('source', '?')} → {match.get('target', '?')} ({match.get('confidence', 0)}%)",
                        "animated": True,
                        "style": {
                            "stroke": "#8b5cf6",
                            "strokeDasharray": "5,5",
                        },
                    })

        # ── Summary stats ─────────────────────────────────────
        summary = {
            "total_source_tables": len(source_schema),
            "total_target_tables": len(target_schema),
            "matched_tables": len(diff_result.get("matched_tables", [])),
            "missing_in_target": len(diff_result.get("missing_tables_in_target", [])),
            "missing_in_source": len(diff_result.get("missing_tables_in_source", [])),
            "total_annotations": len(annotations),
            "high_risk_count": sum(1 for a in annotations if a.get("severity") == "high"),
            "medium_risk_count": sum(1 for a in annotations if a.get("severity") == "medium"),
        }

        return {
            "nodes": nodes,
            "edges": edges,
            "annotations": annotations,
            "summary": summary,
        }
