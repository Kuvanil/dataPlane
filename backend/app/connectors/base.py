from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional


@dataclass
class TestConnectionResult:
    """Structured outcome of a connectivity test (connector_tasks #4, FR4).

    On success the boolean check fields are all True. On failure, the
    fields describe how far the test got: reachable=False means the host
    couldn't be contacted at all; reachable=True + authenticated=False
    means the host answered but rejected the credentials; etc.
    """
    __test__ = False  # not a pytest class, despite the Test* name

    success: bool
    reachable: bool = True
    authenticated: bool = True
    database_accessible: bool = True
    version: Optional[str] = None
    latency_ms: Optional[int] = None
    error_message: Optional[str] = None
    error_code: Optional[str] = None


def classify_connection_error(error_msg: str) -> TestConnectionResult:
    """Map a driver error message onto a failed TestConnectionResult.

    Shared by every connector so the heuristic keyword chain lives in one
    place. Message text varies by driver version/locale — the error_code
    is the structured signal; the raw message rides along as detail.
    """
    msg = (error_msg or "").lower()
    if "timed out" in msg or "timeout" in msg:
        return TestConnectionResult(
            success=False, reachable=False, authenticated=False,
            database_accessible=False,
            error_message=error_msg, error_code="CONNECTION_TIMEOUT",
        )
    if ("could not connect" in msg or "connection refused" in msg
            or "could not translate host" in msg or "name or service not known"
            in msg or "nodename nor servname" in msg or "unreachable" in msg
            or "getaddrinfo" in msg or "unable to open database" in msg
            or "no such file" in msg or "can't connect" in msg):
        return TestConnectionResult(
            success=False, reachable=False, authenticated=False,
            database_accessible=False,
            error_message=error_msg, error_code="CONNECTION_REFUSED",
        )
    if ("authentication failed" in msg or "password" in msg
            or "access denied" in msg or "login" in msg
            or "invalid username" in msg or "ora-01017" in msg):
        return TestConnectionResult(
            success=False, reachable=True, authenticated=False,
            database_accessible=False,
            error_message=error_msg, error_code="AUTH_FAILED",
        )
    if ("database" in msg and ("does not exist" in msg or "not found" in msg
                               or "unknown" in msg)) or "read-only" in msg \
            or "in recovery" in msg or "readonly" in msg:
        return TestConnectionResult(
            success=False, reachable=True, authenticated=True,
            database_accessible=False,
            error_message=error_msg, error_code="DATABASE_UNAVAILABLE",
        )
    return TestConnectionResult(
        success=False, reachable=True, authenticated=True,
        database_accessible=False,
        error_message=error_msg, error_code="UNKNOWN_ERROR",
    )


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
    def test_connection(self) -> TestConnectionResult:
        """Test connectivity and return structured diagnostics.

        Implementations must never raise — every failure is caught and
        classified via classify_connection_error()."""
        pass

    @abstractmethod
    def get_tables(self) -> List[str]:
        """Fetch list of all table names inside the database/schema."""
        pass

    @abstractmethod
    def get_table_schema(self, table_name: str) -> List[Dict[str, Any]]:
        """
        Fetch columns of a table returning list of dicts:
        [{'name': 'id', 'type': 'INT', 'nullable': False, 'primary_key': True,
          'foreign_keys': [{'references_table': 'orders', 'references_column': 'id'}]}]

        'foreign_keys' is optional (omit or return [] if the connector can't
        determine it) -- callers must not assume every implementation
        populates it.
        """
        pass

    @abstractmethod
    def close(self):
        """Close connection handles safely."""
        pass
