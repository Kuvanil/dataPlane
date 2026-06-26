import sqlite3
from typing import List, Dict, Any
from .base import BaseConnector

class SQLiteConnector(BaseConnector):
    """
    Connector for local SQLite databases.
    """
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None

    def connect(self) -> sqlite3.Connection:
        if not self.conn:
            self.conn = sqlite3.connect(self.db_path)
            self.conn.row_factory = sqlite3.Row
        return self.conn

    def test_connection(self) -> bool:
        try:
            conn = self.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            return cursor.fetchone()[0] == 1
        except Exception:
            return False

    def get_tables(self) -> List[str]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        return [row["name"] for row in cursor.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        
        schema = []
        for col in columns:
            schema.append({
                "name": col["name"],
                "type": col["type"],
                "nullable": col["notnull"] == 0,
                "primary_key": col["pk"] == 1
            })
        return schema

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
