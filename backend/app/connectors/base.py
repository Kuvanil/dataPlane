from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseConnector(ABC):
    """
    Abstract Base Class for all database connectors.
    Provides common interface for connection management and schema extraction.
    """

    @abstractmethod
    def connect(self) -> Any:
        """Establish connection to the target system and return handle/session."""
        pass

    @abstractmethod
    def test_connection(self) -> bool:
        """Test if the connection credentials work returns boolean."""
        pass

    @abstractmethod
    def get_tables(self) -> List[str]:
        """Fetch list of all table names inside the database/schema."""
        pass

    @abstractmethod
    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        """
        Fetch columns of a table returning list of dicts:
        [{'name': 'id', 'type': 'INT', 'nullable': False, 'primary_key': True}]
        """
        pass

    @abstractmethod
    def close(self):
        """Close connection handles safely."""
        pass
