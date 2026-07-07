"""
Oracle Database Connector.

Uses oracledb (the successor to cx_Oracle) when a real Oracle instance is available.
Falls back to SQLite simulation with Oracle-style naming for demo environments
where no Oracle DB is present.
"""

import time
from typing import List, Dict, Any
from .base import BaseConnector, TestConnectionResult, classify_connection_error


class OracleConnector(BaseConnector):
    """
    Connector for Oracle Database.
    In demo mode (dsn starts with 'sim://'), uses an internal SQLite file
    to simulate Oracle schema introspection.
    """

    def __init__(self, host: str, port: int, service_name: str, user: str, password: str):
        self.host = host
        self.port = int(port)
        self.service_name = service_name
        self.user = user
        self.password = password
        self.conn = None
        self._sim_mode = host.startswith("sim://") or host == "localhost-sim"

    # ── Connection ──────────────────────────────────────────────

    def connect(self):
        if self.conn:
            return self.conn

        if self._sim_mode:
            import sqlite3, os
            os.makedirs("/shared/data", exist_ok=True)
            db_path = f"/shared/data/dataplane_oracle_sim_{self.service_name}.db"
            # check_same_thread=False: test_connection runs inside a timeout
            # worker thread while close() happens on the request thread.
            self.conn = sqlite3.connect(db_path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            return self.conn

        try:
            import oracledb
            dsn = oracledb.makedsn(self.host, self.port, service_name=self.service_name)
            self.conn = oracledb.connect(user=self.user, password=self.password, dsn=dsn)
            return self.conn
        except Exception as exc:
            raise ConnectionError(f"Oracle connection failed: {exc}")

    def test_connection(self) -> TestConnectionResult:
        try:
            start = time.monotonic()
            conn = self.connect()
            cur = conn.cursor()
            if self._sim_mode:
                cur.execute("SELECT sqlite_version()")
                version = f"Oracle (simulated, SQLite {cur.fetchone()[0]})"
            else:
                cur.execute("SELECT banner FROM v$version WHERE ROWNUM = 1")
                row = cur.fetchone()
                version = row[0] if row else None
            latency = int((time.monotonic() - start) * 1000)
            return TestConnectionResult(
                success=True, version=version, latency_ms=latency,
            )
        except Exception as e:
            return classify_connection_error(str(e))

    # ── Schema Introspection ────────────────────────────────────

    def get_tables(self) -> List[str]:
        conn = self.connect()
        cur = conn.cursor()
        if self._sim_mode:
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            return [r[0] if isinstance(r, tuple) else r["name"] for r in cur.fetchall()]
        else:
            cur.execute("""
                SELECT table_name FROM all_tables
                WHERE owner = UPPER(:owner)
                ORDER BY table_name
            """, {"owner": self.user})
            return [r[0] for r in cur.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cur = conn.cursor()

        if self._sim_mode:
            cur.execute(f"PRAGMA table_info({table_name})")
            rows = cur.fetchall()
            fk_cur = conn.cursor()
            fk_cur.execute(f"PRAGMA foreign_key_list({table_name})")
            fks_by_column: Dict[str, List[Dict[str, str]]] = {}
            for r in fk_cur.fetchall():
                # PRAGMA foreign_key_list columns: (id, seq, table, from, to, ...)
                col = r["from"] if isinstance(r, dict) else r[3]
                ref_table = r["table"] if isinstance(r, dict) else r[2]
                ref_col = r["to"] if isinstance(r, dict) else r[4]
                fks_by_column.setdefault(col, []).append({
                    "references_table": ref_table,
                    "references_column": ref_col,
                })
            return [
                {
                    "name": (name := r["name"] if isinstance(r, dict) else r[1]),
                    "type": r["type"] if isinstance(r, dict) else r[2],
                    "nullable": (r["notnull"] if isinstance(r, dict) else r[3]) == 0,
                    "primary_key": (r["pk"] if isinstance(r, dict) else r[5]) == 1,
                    "foreign_keys": fks_by_column.get(name, []),
                }
                for r in rows
            ]

        cur.execute("""
            SELECT column_name AS name,
                   data_type   AS type,
                   nullable
            FROM all_tab_columns
            WHERE owner      = UPPER(:owner)
              AND table_name  = UPPER(:tbl)
            ORDER BY column_id
        """, {"owner": self.user, "tbl": table_name})
        cols = cur.fetchall()
        desc = [d[0].lower() for d in cur.description]

        pk_cur = conn.cursor()
        pk_cur.execute("""
            SELECT acc.column_name
            FROM all_constraints ac
            JOIN all_cons_columns acc
              ON ac.constraint_name = acc.constraint_name
             AND ac.owner = acc.owner
            WHERE ac.constraint_type = 'P'
              AND ac.owner      = UPPER(:owner)
              AND ac.table_name = UPPER(:tbl)
        """, {"owner": self.user, "tbl": table_name})
        pk_cols = {row[0] for row in pk_cur.fetchall()}

        fk_cur = conn.cursor()
        fk_cur.execute("""
            SELECT acc.column_name, r_acc.table_name AS references_table,
                   r_acc.column_name AS references_column
            FROM all_constraints ac
            JOIN all_cons_columns acc
              ON ac.constraint_name = acc.constraint_name
             AND ac.owner = acc.owner
            JOIN all_cons_columns r_acc
              ON ac.r_constraint_name = r_acc.constraint_name
             AND ac.owner = r_acc.owner
            WHERE ac.constraint_type = 'R'
              AND ac.owner      = UPPER(:owner)
              AND ac.table_name = UPPER(:tbl)
        """, {"owner": self.user, "tbl": table_name})
        fks_by_column: Dict[str, List[Dict[str, str]]] = {}
        for row in fk_cur.fetchall():
            fks_by_column.setdefault(row[0], []).append({
                "references_table": row[1],
                "references_column": row[2],
            })

        schema = []
        for row in cols:
            rd = dict(zip(desc, row))
            schema.append({
                "name": rd["name"],
                "type": rd["type"],
                "nullable": rd["nullable"] == "Y",
                "primary_key": rd["name"] in pk_cols,
                "foreign_keys": fks_by_column.get(rd["name"], []),
            })
        return schema

    def execute_query(self, sql: str) -> List[Dict[str, Any]]:
        conn = self.connect()
        cur = conn.cursor()
        cur.execute(sql)
        if self._sim_mode:
            keys = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(keys, row)) for row in cur.fetchall()]
        desc = [d[0].lower() for d in cur.description]
        return [dict(zip(desc, row)) for row in cur.fetchall()]

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
