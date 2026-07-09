import time
import pymysql
from pymysql.cursors import DictCursor
from typing import List, Dict, Any
from .base import BaseConnector, TestConnectionResult, classify_connection_error


class MySQLConnector(BaseConnector):
    """
    Connector for MySQL databases using PyMySQL.
    """

    def __init__(self, host: str, port: int, dbname: str, user: str, password: str):
        self.config = {
            "host": host,
            "port": int(port),
            "database": dbname,
            "user": user,
            "password": password,
        }
        self.conn = None

    def connect(self):
        if not self.conn:
            # Driver-level timeout slightly under the 5s API timeout so the
            # driver's own error message wins over a generic future-timeout.
            self.conn = pymysql.connect(**self.config, cursorclass=DictCursor,
                                        connect_timeout=4)
        return self.conn

    def test_connection(self) -> TestConnectionResult:
        try:
            start = time.monotonic()
            conn = self.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT VERSION() AS v")
            version = cursor.fetchone()["v"]
            latency = int((time.monotonic() - start) * 1000)
            return TestConnectionResult(
                success=True,
                version=f"MySQL {version}" if version else None,
                latency_ms=latency,
            )
        except Exception as e:
            return classify_connection_error(str(e))

    def get_tables(self) -> List[str]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("SHOW TABLES")
        return [list(row.values())[0] for row in cursor.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                c.COLUMN_NAME   AS name,
                c.DATA_TYPE     AS type,
                c.IS_NULLABLE   AS nullable,
                c.COLUMN_KEY    AS col_key,
                k.REFERENCED_TABLE_NAME  AS ref_table,
                k.REFERENCED_COLUMN_NAME AS ref_column
            FROM information_schema.COLUMNS c
            LEFT JOIN information_schema.KEY_COLUMN_USAGE k
              ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
             AND c.TABLE_NAME = k.TABLE_NAME
             AND c.COLUMN_NAME = k.COLUMN_NAME
             AND k.REFERENCED_TABLE_NAME IS NOT NULL
            WHERE c.TABLE_SCHEMA = DATABASE()
              AND c.TABLE_NAME   = %s
            ORDER BY c.ORDINAL_POSITION
        """, (table_name,))
        rows = cursor.fetchall()
        # A LEFT JOIN to KEY_COLUMN_USAGE can return >1 row per column if the
        # column participates in more than one FK constraint; group by name
        # so the column list itself never duplicates, only its foreign_keys.
        schema_by_name: Dict[str, Dict[str, Any]] = {}
        order: List[str] = []
        for r in rows:
            name = r["name"]
            if name not in schema_by_name:
                order.append(name)
                schema_by_name[name] = {
                    "name": name,
                    "type": r["type"],
                    "nullable": r["nullable"] == "YES",
                    "primary_key": r["col_key"] == "PRI",
                    "foreign_keys": [],
                }
            if r.get("ref_table"):
                schema_by_name[name]["foreign_keys"].append({
                    "references_table": r["ref_table"],
                    "references_column": r["ref_column"],
                })
        return [schema_by_name[n] for n in order]

    def execute_query(self, sql: str) -> List[Dict[str, Any]]:
        """Execute a read-only query and return results."""
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute(sql)
        return cursor.fetchall()

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
