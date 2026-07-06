import psycopg2
from psycopg2.extras import RealDictCursor
from typing import List, Dict, Any
from .base import BaseConnector

class PostgresConnector(BaseConnector):
    """
    Connector for PostgreSQL databases using psycopg2.
    """
    def __init__(self, host: str, port: int, dbname: str, user: str, password: str):
        self.config = {
            'host': host,
            'port': port,
            'dbname': dbname,
            'user': user,
            'password': password
        }
        self.conn = None

    def connect(self):
        if not self.conn:
            self.conn = psycopg2.connect(**self.config)
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
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        return [row[0] for row in cursor.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(f"""
            SELECT column_name as name, data_type as type, is_nullable = 'YES' as nullable
            FROM information_schema.columns
            WHERE table_name = '{table_name}'
        """)
        columns = cursor.fetchall()

        pk_cursor = conn.cursor()
        pk_cursor.execute(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = %s
            """,
            (table_name,),
        )
        pk_cols = {row[0] for row in pk_cursor.fetchall()}

        fk_cursor = conn.cursor()
        fk_cursor.execute(
            """
            SELECT kcu.column_name, ccu.table_name AS references_table,
                   ccu.column_name AS references_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
             AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = %s
            """,
            (table_name,),
        )
        fks_by_column: Dict[str, List[Dict[str, str]]] = {}
        for row in fk_cursor.fetchall():
            fks_by_column.setdefault(row[0], []).append({
                "references_table": row[1],
                "references_column": row[2],
            })

        schema = []
        for col in columns:
            schema.append({
                "name": col["name"],
                "type": col["type"],
                "nullable": col["nullable"],
                "primary_key": col["name"] in pk_cols,
                "foreign_keys": fks_by_column.get(col["name"], []),
            })
        return schema

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
