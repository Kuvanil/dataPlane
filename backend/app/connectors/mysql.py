import pymysql
from pymysql.cursors import DictCursor
from typing import List, Dict, Any
from .base import BaseConnector


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
            self.conn = pymysql.connect(**self.config, cursorclass=DictCursor)
        return self.conn

    def test_connection(self) -> bool:
        try:
            conn = self.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT 1 AS ok")
            return cursor.fetchone()["ok"] == 1
        except Exception:
            return False

    def get_tables(self) -> List[str]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("SHOW TABLES")
        return [list(row.values())[0] for row in cursor.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT
                COLUMN_NAME   AS name,
                DATA_TYPE     AS type,
                IS_NULLABLE   AS nullable,
                COLUMN_KEY    AS col_key
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = %s
            ORDER BY ORDINAL_POSITION
        """, (table_name,))
        rows = cursor.fetchall()
        schema = []
        for r in rows:
            schema.append({
                "name": r["name"],
                "type": r["type"],
                "nullable": r["nullable"] == "YES",
                "primary_key": r["col_key"] == "PRI",
            })
        return schema

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
