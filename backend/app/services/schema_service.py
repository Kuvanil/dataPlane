from typing import List, Dict, Any
from app.connectors.sqlite import SQLiteConnector
from app.connectors.postgres import PostgresConnector
from app.connectors.mysql import MySQLConnector
from app.connectors.oracle import OracleConnector
from app.connectors.jdbc import JDBCConnector
from app.models.connection import DBConnection

def get_connector(connection: DBConnection):
    """
    Factory function to initialize correct connector based on DBConnection model.
    """
    conn_type = connection.type.lower()
    config = connection.config

    if conn_type == "sqlite":
        if "path" not in config:
            raise ValueError("SQLite config must include 'path'")
        return SQLiteConnector(config["path"])
        
    elif conn_type == "postgres":
        required = ["host", "port", "dbname", "user", "password"]
        for r in required:
            if r not in config:
                raise ValueError(f"Postgres config must include '{r}'")
        return PostgresConnector(**config)

    elif conn_type == "mysql":
        required = ["host", "port", "dbname", "user", "password"]
        for r in required:
            if r not in config:
                raise ValueError(f"MySQL config must include '{r}'")
        return MySQLConnector(**config)

    elif conn_type == "oracle":
        required = ["host", "port", "service_name", "user", "password"]
        for r in required:
            if r not in config:
                raise ValueError(f"Oracle config must include '{r}'")
        return OracleConnector(**config)

    elif conn_type == "jdbc":
        if "url" not in config:
            raise ValueError("JDBC config must include 'url'")
        return JDBCConnector(url=config["url"], schema=config.get("schema"))
        
    else:
        raise ValueError(f"Unsupported connector type: {conn_type}")

class SchemaService:
    @staticmethod
    def get_full_schema(connection: DBConnection) -> Dict[str, Any]:
        """
        Extracts full schema structure (tables and columns) from the connection.
        """
        connector = get_connector(connection)
        try:
            tables = connector.get_tables()
            schema_data = {}
            for table in tables:
                schema_data[table] = connector.get_table_schema(table)
            return schema_data
        finally:
            connector.close()

    @staticmethod
    def test_connection(connection: DBConnection) -> bool:
        """
        Test if the connection parameters are correct.
        """
        connector = get_connector(connection)
        try:
            return connector.test_connection()
        finally:
            connector.close()
