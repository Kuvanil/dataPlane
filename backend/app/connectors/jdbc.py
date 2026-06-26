"""
Generic JDBC-style Connector.

Uses SQLAlchemy as a universal abstraction to support any database that
provides a Python DB-API 2.0 driver or SQLAlchemy dialect URL.
"""

from sqlalchemy import create_engine, inspect, text
from typing import List, Dict, Any
from .base import BaseConnector


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

    def test_connection(self) -> bool:
        try:
            conn = self.connect()
            result = conn.execute(text("SELECT 1"))
            return result.scalar() == 1
        except Exception:
            return False

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

        schema_list = []
        for col in columns:
            schema_list.append({
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": col.get("nullable", True),
                "primary_key": col["name"] in pk_cols,
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
