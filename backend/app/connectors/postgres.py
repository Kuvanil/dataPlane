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
        
        # Check primary key separately if needed, simplified for shell
        schema = []
        for col in columns:
            schema.append({
                "name": col["name"],
                "type": col["type"],
                "nullable": col["nullable"],
                "primary_key": False # placeholder simplifed
            })
        return schema

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
