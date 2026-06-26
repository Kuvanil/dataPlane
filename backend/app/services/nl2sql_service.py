"""
Natural Language to SQL Service.

Translates English queries into SQL, executes them safely,
and generates analysis reports.
"""

import json
import re
import requests
from typing import List, Dict, Any, Optional
from app.core.config import settings


class NL2SQLService:
    """Converts natural language to SQL and executes safely."""

    # ── Pre-built query templates ──────────────────────────────

    TEMPLATES = {
        "show all tables": "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        "list tables": "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        "show tables": "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        "count rows": "SELECT '{table}' AS table_name, COUNT(*) AS row_count FROM {table};",
        "describe table": "PRAGMA table_info({table});",
        "show columns": "PRAGMA table_info({table});",
        "find pii columns": None,  # handled specially
        "database health": None,   # handled specially
        "schema gaps": None,       # handled specially
    }

    BLOCKED_KEYWORDS = {"DROP", "DELETE", "TRUNCATE", "ALTER", "INSERT", "UPDATE", "CREATE", "GRANT", "REVOKE"}

    @staticmethod
    def _is_safe(sql: str) -> bool:
        """Check that the query is read-only."""
        upper = sql.upper().strip()
        for kw in NL2SQLService.BLOCKED_KEYWORDS:
            if re.search(rf"\b{kw}\b", upper):
                return False
        return True

    @staticmethod
    def generate_sql(
        natural_query: str,
        schema_context: Dict[str, Any],
        db_type: str = "sqlite",
    ) -> Dict[str, Any]:
        """
        Convert a natural language query to SQL.
        Tries Ollama first, falls back to rule-based templates.
        """
        query_lower = natural_query.lower().strip()

        # ── Rule-based fast path ──────────────────────────────
        for pattern, template in NL2SQLService.TEMPLATES.items():
            if pattern in query_lower:
                if template:
                    # Substitute table name if needed
                    tables = list(schema_context.keys())
                    table = tables[0] if tables else "unknown"
                    # Check if user mentioned a specific table
                    for t in tables:
                        if t.lower() in query_lower:
                            table = t
                            break
                    sql = template.format(table=table)
                    return {"sql": sql, "method": "template", "confidence": 95}

        # ── Special report queries ────────────────────────────
        if "pii" in query_lower or "sensitive" in query_lower:
            return NL2SQLService._pii_query(schema_context)
        if "health" in query_lower or "report" in query_lower:
            return NL2SQLService._health_report(schema_context)

        # ── LLM path via Ollama ───────────────────────────────
        schema_desc = NL2SQLService._schema_to_desc(schema_context)
        prompt = f"""You are a SQL expert. Convert the following natural language request to a valid {db_type} SQL query.

DATABASE SCHEMA:
{schema_desc}

USER REQUEST: {natural_query}

Rules:
- Return ONLY the SQL query, nothing else
- Use only SELECT statements (read-only)
- Reference only tables and columns that exist in the schema above

SQL:"""

        try:
            resp = requests.post(
                f"{settings.OLLAMA_HOST}/api/generate",
                json={"model": "llama3", "prompt": prompt, "stream": False},
                timeout=15,
            )
            if resp.status_code == 200:
                generated = resp.json().get("response", "").strip()
                # Extract SQL from potential markdown code fences
                sql_match = re.search(r"```sql\s*(.*?)```", generated, re.DOTALL)
                sql = sql_match.group(1).strip() if sql_match else generated.strip()
                if NL2SQLService._is_safe(sql):
                    return {"sql": sql, "method": "llm", "confidence": 88}
                return {"sql": sql, "method": "llm", "confidence": 0, "blocked": True, "reason": "Unsafe query detected"}
        except Exception as e:
            pass  # Fallback below

        # ── Heuristic fallback ────────────────────────────────
        return NL2SQLService._heuristic_generate(natural_query, schema_context)

    @staticmethod
    def _pii_query(schema_context: Dict[str, Any]) -> Dict[str, Any]:
        pii_keywords = ["email", "phone", "ssn", "password", "credit", "card", "address", "name"]
        results = []
        for table, cols in schema_context.items():
            for col in cols:
                col_name = col["name"].lower() if isinstance(col, dict) else str(col).lower()
                for kw in pii_keywords:
                    if kw in col_name:
                        results.append({"table": table, "column": col_name if isinstance(col, str) else col["name"], "pii_keyword": kw})
                        break
        return {
            "sql": "-- PII Analysis (rule-based scan)",
            "method": "analysis",
            "confidence": 97,
            "results": results,
            "report_type": "pii_scan",
        }

    @staticmethod
    def _health_report(schema_context: Dict[str, Any]) -> Dict[str, Any]:
        tables = list(schema_context.keys())
        total_cols = sum(len(v) for v in schema_context.values())
        nullable_count = sum(
            1 for cols in schema_context.values()
            for c in cols if isinstance(c, dict) and c.get("nullable", False)
        )
        pk_count = sum(
            1 for cols in schema_context.values()
            for c in cols if isinstance(c, dict) and c.get("primary_key", False)
        )
        return {
            "sql": "-- Database Health Report (metadata analysis)",
            "method": "analysis",
            "confidence": 99,
            "report_type": "health",
            "results": {
                "total_tables": len(tables),
                "total_columns": total_cols,
                "nullable_columns": nullable_count,
                "primary_keys": pk_count,
                "tables_without_pk": [
                    t for t, cols in schema_context.items()
                    if not any(c.get("primary_key", False) for c in cols if isinstance(c, dict))
                ],
                "health_score": min(100, 60 + pk_count * 5 + len(tables) * 3),
            },
        }

    @staticmethod
    def _heuristic_generate(query: str, schema_context: Dict[str, Any]) -> Dict[str, Any]:
        tables = list(schema_context.keys())
        if not tables:
            return {"sql": "SELECT 'No tables available' AS message;", "method": "fallback", "confidence": 50}

        query_lower = query.lower()
        target_table = tables[0]
        for t in tables:
            if t.lower() in query_lower:
                target_table = t
                break

        if "count" in query_lower:
            sql = f"SELECT COUNT(*) AS total FROM {target_table};"
        elif "all" in query_lower or "everything" in query_lower or "select" in query_lower:
            sql = f"SELECT * FROM {target_table} LIMIT 100;"
        elif "column" in query_lower or "schema" in query_lower or "structure" in query_lower:
            sql = f"PRAGMA table_info({target_table});"
        else:
            sql = f"SELECT * FROM {target_table} LIMIT 50;"

        return {"sql": sql, "method": "heuristic", "confidence": 70}

    @staticmethod
    def execute_safe_query(connector, sql: str) -> Dict[str, Any]:
        """Execute a read-only query using the given connector."""
        if not NL2SQLService._is_safe(sql):
            return {"error": "Query blocked: contains write operations", "results": []}
        try:
            if hasattr(connector, "execute_query"):
                rows = connector.execute_query(sql)
            else:
                conn = connector.connect()
                cur = conn.cursor()
                cur.execute(sql)
                if cur.description:
                    keys = [d[0] for d in cur.description]
                    rows = [dict(zip(keys, row)) for row in cur.fetchall()]
                else:
                    rows = []
            return {"results": rows, "row_count": len(rows)}
        except Exception as e:
            return {"error": str(e), "results": []}

    @staticmethod
    def _schema_to_desc(schema_context: Dict[str, Any]) -> str:
        lines = []
        for table, cols in schema_context.items():
            col_parts = []
            for c in cols:
                if isinstance(c, dict):
                    pk = " PRIMARY KEY" if c.get("primary_key") else ""
                    col_parts.append(f"  {c['name']} {c.get('type', 'TEXT')}{pk}")
                else:
                    col_parts.append(f"  {c}")
            lines.append(f"TABLE {table}(\n" + ",\n".join(col_parts) + "\n)")
        return "\n\n".join(lines)

    @staticmethod
    def generate_analysis_report(schema_context: Dict[str, Any]) -> Dict[str, Any]:
        """Comprehensive database analysis report."""
        pii_result = NL2SQLService._pii_query(schema_context)
        health_result = NL2SQLService._health_report(schema_context)

        # Type diversity analysis
        type_counts: Dict[str, int] = {}
        for cols in schema_context.values():
            for c in cols:
                if isinstance(c, dict):
                    t = c.get("type", "UNKNOWN").upper()
                    type_counts[t] = type_counts.get(t, 0) + 1

        return {
            "report_type": "comprehensive",
            "health": health_result.get("results", {}),
            "pii_findings": pii_result.get("results", []),
            "type_distribution": type_counts,
            "recommendations": NL2SQLService._generate_recommendations(
                health_result.get("results", {}),
                pii_result.get("results", []),
            ),
        }

    @staticmethod
    def _generate_recommendations(health: Dict, pii: List) -> List[str]:
        recs = []
        if health.get("tables_without_pk"):
            recs.append(f"⚠️ {len(health['tables_without_pk'])} table(s) lack primary keys: {', '.join(health['tables_without_pk'])}")
        if health.get("nullable_columns", 0) > health.get("total_columns", 1) * 0.6:
            recs.append("⚠️ Over 60% of columns are nullable — consider adding NOT NULL constraints for data integrity")
        if pii:
            recs.append(f"🛡️ {len(pii)} PII column(s) detected — ensure encryption at rest and masking in exports")
        if health.get("health_score", 0) < 75:
            recs.append("📊 Health score below 75 — review schema design and add indexes")
        if not recs:
            recs.append("✅ Database looks healthy — no critical issues detected")
        return recs
