"""
Generic JDBC-style Connector.

Uses SQLAlchemy as a universal abstraction to support any database that
provides a Python DB-API 2.0 driver or SQLAlchemy dialect URL.
"""

import time
from sqlalchemy import create_engine, inspect, text
from typing import List, Dict, Any
from .base import BaseConnector, TestConnectionResult, classify_connection_error


class JDBCConnector(BaseConnector):
    """
    Generic connector that accepts a SQLAlchemy-compatible connection URL.
    Works with any dialect: postgresql, mysql, sqlite, mssql, etc.

    Config expects: {"url": "dialect+driver://user:pass@host:port/dbname"}
    """

    def __init__(self, url: str, schema: str = None):
        self.url = url
        self.schema = schema
        self.engine = None
        self.conn = None

    def connect(self):
        if not self.engine:
            self.engine = create_engine(self.url, pool_pre_ping=True)
        if not self.conn:
            self.conn = self.engine.connect()
        return self.conn

    def test_connection(self) -> TestConnectionResult:
        try:
            start = time.monotonic()
            conn = self.connect()
            result = conn.execute(text("SELECT 1"))
            ok = result.scalar() == 1
            latency = int((time.monotonic() - start) * 1000)
            if not ok:
                return TestConnectionResult(
                    success=False, reachable=True,
                    database_accessible=False,
                    error_message="SELECT 1 returned an unexpected result",
                    error_code="UNKNOWN_ERROR",
                )
            dialect = self.engine.dialect
            server_info = getattr(dialect, "server_version_info", None)
            version = (f"{dialect.name} "
                       + ".".join(str(p) for p in server_info)) if server_info else dialect.name
            return TestConnectionResult(
                success=True, version=version, latency_ms=latency,
            )
        except Exception as e:
            return classify_connection_error(str(e))

    def get_tables(self) -> List[str]:
        self.connect()
        insp = inspect(self.engine)
        return insp.get_table_names(schema=self.schema)

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        self.connect()
        insp = inspect(self.engine)
        columns = insp.get_columns(table_name, schema=self.schema)
        pk_cols = set()
        try:
            pk = insp.get_pk_constraint(table_name, schema=self.schema)
            pk_cols = set(pk.get("constrained_columns", []))
        except Exception:
            pass

        fks_by_column: Dict[str, List[Dict[str, str]]] = {}
        try:
            for fk in insp.get_foreign_keys(table_name, schema=self.schema):
                referred_table = fk.get("referred_table")
                for local_col, remote_col in zip(
                    fk.get("constrained_columns", []),
                    fk.get("referred_columns", []),
                ):
                    fks_by_column.setdefault(local_col, []).append({
                        "references_table": referred_table,
                        "references_column": remote_col,
                    })
        except Exception:
            pass

        schema_list = []
        for col in columns:
            schema_list.append({
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": col.get("nullable", True),
                "primary_key": col["name"] in pk_cols,
                "foreign_keys": fks_by_column.get(col["name"], []),
            })
        return schema_list

    def execute_query(self, sql: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        result = conn.execute(text(sql))
        keys = list(result.keys())
        return [dict(zip(keys, row)) for row in result.fetchall()]

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
        if self.engine:
            self.engine.dispose()
            self.engine = None
