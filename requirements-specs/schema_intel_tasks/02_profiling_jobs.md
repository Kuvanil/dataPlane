# Task #2 — Profiling jobs (async, bounded samples) (SI-T2)

**TRD reference:** FR2, FR7, Performance NFR ("100-column table ≤ 60s"), §12 DoD "Profiling metrics computed."

**Current state:** NOT STARTED. An exhaustive grep across `backend/app` for `null_rate`,
`cardinality`, `distinct_count`, `profil(e|ing)`, `sample_values`, `min_value`/`max_value` returns
zero matches related to column data profiling — the only `row_count` hits are query-execution
result metadata (`backend/app/models/query_history.py:16`), unrelated. No connector executes a
`COUNT`, `COUNT(DISTINCT ...)`, `MIN/MAX`, or sampling query against actual table data; connectors
only introspect column metadata. This is a from-scratch build.

**Precondition:** Task #8 (PII data-safety sign-off) has been completed. The four compliance
decisions from that task are baked into this design:
1. `sample_values` is NOT persisted — held in-memory during profiling, passed to classification,
   then discarded.
2. `SCHEMA_INTEL_SAMPLE_LIMIT` defaults to 1,000 rows.
3. `SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS` defaults to 100,000.
4. Profiling reuses the existing connection credential (with a warning log on first use per
   connection recommending separate read-only credentials for production).

## Scope

### Model — `ColumnProfile` (new, in `backend/app/models/schema_catalog.py`)

```python
class ColumnProfile(Base):
    """Per-column profiling metrics. No raw sample values are persisted (per Task #8)."""
    __tablename__ = "column_profiles"
    __table_args__ = (
        UniqueConstraint("column_id", name="uq_column_profile"),
    )

    id = Column(Integer, primary_key=True, index=True)
    column_id = Column(Integer, ForeignKey("catalog_columns.id", ondelete="CASCADE"),
                       nullable=False, unique=True, index=True)

    # Aggregate metrics (computed from sampled data, safe to persist)
    null_count = Column(Integer, nullable=False, default=0)
    null_rate = Column(Float, nullable=False, default=0.0)       # 0.0 – 1.0
    distinct_count = Column(Integer, nullable=True)               # None if too expensive (BLOB, etc.)
    min_value = Column(String, nullable=True)                     # String-ified, connector-agnostic
    max_value = Column(String, nullable=True)                     # String-ified, connector-agnostic
    sample_size_used = Column(Integer, nullable=False, default=0) # How many rows were sampled

    profiled_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    column = relationship("CatalogColumn", backref="profile", uselist=False)
```

**Key design decisions (from Task #8):**
- `sample_values` is deliberately absent from this model. Sampled values exist only in-memory
  during the profiling Celery task and are passed to Task #3's classification step, then dropped.
- `sample_size_used` is metadata (how many rows were sampled), not data — safe to persist.
- `min_value`/`max_value` are single values per column, not a sample set. They are persisted as
  strings. The deployment guide requires database-level encryption at rest (infra control).

### Connector contract — `BaseConnector.profile_column`

Add a new method to `backend/app/connectors/base.py`:

```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class ColumnProfileResult:
    null_count: int = 0
    null_rate: float = 0.0
    distinct_count: int | None = None
    min_value: str | None = None
    max_value: str | None = None
    sample_values: list[Any] = field(default_factory=list)  # In-memory only, NOT persisted
    sample_size_used: int = 0
    error: str | None = None  # Non-fatal: e.g. "MIN/MAX not supported for JSON type"

class BaseConnector(ABC):
    # ... existing methods ...

    def profile_column(self, table: str, column: str,
                       sample_limit: int = 1000,
                       distinct_scan_limit: int = 100000) -> ColumnProfileResult:
        """Profile a single column: null rate, distinct count, min/max, sample values.

        The default implementation issues standard SQL. Subclasses may override
        to use dialect-specific optimizations (e.g. Postgres's `approx_distinct`).

        :param sample_limit: Max rows to sample for null-rate and sample_values.
        :param distinct_scan_limit: Max rows to scan for COUNT(DISTINCT ...).
        :returns: ColumnProfileResult with aggregate metrics. sample_values is
                  in-memory only and must NOT be persisted (per Task #8).
        """
        raise NotImplementedError("Subclasses must implement profile_column")
```

### Per-connector implementations

Each connector subclass implements `profile_column` using its dialect's SQL. The default
implementation in `BaseConnector` issues:

```sql
SELECT
    COUNT(*) AS total,
    COUNT(col) AS non_null,
    COUNT(DISTINCT col) AS distinct_count,
    MIN(col) AS min_val,
    MAX(col) AS max_val
FROM table
```

Plus a bounded sample:
```sql
SELECT col FROM table WHERE col IS NOT NULL LIMIT :sample_limit
```

**Guard for non-comparable types:** If `MIN/MAX` fails (e.g. on JSON/BLOB columns), catch the
dialect error and record `null` for those fields rather than failing the whole column. The
`error` field on `ColumnProfileResult` records which metrics were unavailable.

**Guard for expensive distinct counts:** If `COUNT(DISTINCT col)` is known to be expensive
(e.g. on TEXT columns without an index in Postgres), the connector may skip it and return
`distinct_count=None`. The `distinct_scan_limit` parameter caps the scan for implementations
that use a sampled distinct count (e.g. Postgres's `approx_distinct` extension).

**SQLite implementation (reference):**
```python
def profile_column(self, table: str, column: str,
                   sample_limit: int = 1000,
                   distinct_scan_limit: int = 100000) -> ColumnProfileResult:
    cursor = self.conn.execute(f"SELECT COUNT(*), COUNT({column}), "
                               f"COUNT(DISTINCT {column}), "
                               f"MIN({column}), MAX({column}) "
                               f"FROM [{table}]")
    row = cursor.fetchone()
    total, non_null, distinct_count, min_val, max_val = row

    # Bounded sample (non-null values only)
    sample = []
    try:
        sample_cursor = self.conn.execute(
            f"SELECT {column} FROM [{table}] "
            f"WHERE {column} IS NOT NULL LIMIT ?",
            (sample_limit,)
        )
        sample = [r[0] for r in sample_cursor.fetchall()]
    except Exception:
        pass  # Non-fatal — sample is best-effort

    null_count = total - non_null
    null_rate = null_count / total if total > 0 else 0.0

    return ColumnProfileResult(
        null_count=null_count,
        null_rate=null_rate,
        distinct_count=distinct_count,
        min_value=str(min_val) if min_val is not None else None,
        max_value=str(max_val) if max_val is not None else None,
        sample_values=sample,
        sample_size_used=min(sample_limit, len(sample)),
    )
```

**Important:** Column names and table names must be properly quoted/escaped per dialect to
prevent SQL injection. The connector's table/column names come from the catalog (trusted
metadata), not user input, but defense-in-depth applies. Use the dialect's quote method
(e.g. `conn.execute(text(f"SELECT ...").bindparams(...))` with SQLAlchemy's `text()` for
parameterized queries).

### Celery tasks — `backend/app/tasks/schema_intel_tasks.py` (new)

```python
from celery import shared_task
from app.core.celery_app import celery_app

# Track which connections have been warned about shared credentials
_warned_connections: set[int] = set()


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def profile_column_task(self, connection_id: int, table_name: str,
                        column_id: int, column_name: str, data_type: str):
    """Profile a single column. One task per column for granular retry."""
    from app.core.database import SessionLocal
    from app.models.connection import DBConnection
    from app.models.schema_catalog import CatalogColumn, ColumnProfile
    from app.services.schema_service import get_connector
    from app.core.config import settings

    db = SessionLocal()
    try:
        conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
        if not conn:
            return {"status": "skipped", "reason": "connection not found"}

        # Warn about shared credentials once per connection (Task #8 Decision 4)
        if connection_id not in _warned_connections:
            import logging
            logging.getLogger(__name__).warning(
                "Profiling connection %d using the same credentials as the Connector module. "
                "Separate read-only scan credentials are recommended for production.",
                connection_id,
            )
            _warned_connections.add(connection_id)

        # Build config with secrets resolved
        config = dict(conn.config or {})
        if conn.secrets_ref:
            from app.services.secret_manager import get_secret_manager
            secrets = get_secret_manager().retrieve(conn.secrets_ref)
            config.update(secrets)

        connector = get_connector(conn.type)(config)
        try:
            result = connector.profile_column(
                table=table_name,
                column=column_name,
                sample_limit=settings.SCHEMA_INTEL_SAMPLE_LIMIT,
                distinct_scan_limit=settings.SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS,
            )
        finally:
            connector.close()

        # Persist aggregates only (sample_values is in-memory only — Task #8 Decision 1)
        profile = ColumnProfile(
            column_id=column_id,
            null_count=result.null_count,
            null_rate=result.null_rate,
            distinct_count=result.distinct_count,
            min_value=result.min_value,
            max_value=result.max_value,
            sample_size_used=result.sample_size_used,
        )
        db.merge(profile)  # Upsert — one profile per column
        db.commit()

        return {
            "status": "completed",
            "column_id": column_id,
            "null_rate": result.null_rate,
            "distinct_count": result.distinct_count,
            "sample_size": result.sample_size_used,
        }
    except Exception as e:
        db.rollback()
        raise self.retry(exc=e)
    finally:
        db.close()


@celery_app.task
def profile_table_task(connection_id: int, table_name: str, columns: list[dict]):
    """Fan out one profile_column_task per column in a table.

    Uses Celery group() so columns are profiled in parallel.
    """
    from celery import group

    task_group = group(
        profile_column_task.s(
            connection_id=connection_id,
            table_name=table_name,
            column_id=col["id"],
            column_name=col["column_name"],
            data_type=col["data_type"],
        )
        for col in columns
    )
    result = task_group()
    return {"table": table_name, "columns_profiled": len(columns), "results": result}


@celery_app.task
def profile_connection_task(connection_id: int):
    """Fan out one profile_table_task per table in a connection.

    Called by the POST /profile endpoint.
    """
    from app.core.database import SessionLocal
    from app.models.schema_catalog import CatalogTable

    db = SessionLocal()
    try:
        tables = (
            db.query(CatalogTable)
            .filter(CatalogTable.connection_id == connection_id)
            .all()
        )
        if not tables:
            return {"status": "skipped", "reason": "no tables discovered for this connection"}

        from celery import group

        task_group = group(
            profile_table_task.s(
                connection_id=connection_id,
                table_name=t.table_name,
                columns=[
                    {"id": c.id, "column_name": c.column_name, "data_type": c.data_type}
                    for c in t.columns
                ],
            )
            for t in tables
        )
        results = task_group()
        total_columns = sum(len(t.columns) for t in tables)
        return {
            "status": "completed",
            "connection_id": connection_id,
            "tables": len(tables),
            "columns": total_columns,
        }
    finally:
        db.close()
```

### Configuration — `backend/app/core/config.py`

Add to the existing `Settings` class:

```python
# Schema Intel profiling
SCHEMA_INTEL_SAMPLE_LIMIT: int = 1000          # Task #8 Decision 2
SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS: int = 100000  # Task #8 Decision 2
SCHEMA_INTEL_USE_SEPARATE_CREDENTIALS: bool = False  # Task #8 Decision 4
```

### Router endpoint — extend `backend/app/api/routers/schema_catalog.py`

```python
@router.post("/{connection_id}/profile")
def profile_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Enqueue profiling for all tables in a connection. Returns a task_id for polling."""
    # Verify connection exists
    from app.models.connection import DBConnection
    conn = db.query(DBConnection).filter(DBConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Verify catalog tables exist
    from app.models.schema_catalog import CatalogTable
    tables = db.query(CatalogTable).filter(CatalogTable.connection_id == connection_id).count()
    if tables == 0:
        raise HTTPException(
            status_code=400,
            detail="No catalog tables found. Run discovery (POST /discover) first.",
        )

    # Enqueue
    from app.tasks.schema_intel_tasks import profile_connection_task
    task = profile_connection_task.delay(connection_id)

    from app.services.audit_helper import record_audit
    record_audit(db, "profiling_started", connection_id=connection_id,
                 connection_name=conn.name, payload={"task_id": task.id})

    return {
        "status": "queued",
        "task_id": task.id,
        "message": f"Profiling {tables} table(s). Poll GET /api/v1/tasks/{task.id} for status.",
    }
```

### In-memory sample handoff to Task #3 (classification)

The `profile_column_task` returns `sample_values` in its result object, but this is the Celery
task result (stored in the result backend, which is `cache+memory://` in dev — ephemeral). The
classification task (Task #3) receives these values as a parameter:

```python
# Pseudocode for Task #3's integration:
@celery_app.task
def classify_column_task(column_id: int, sample_values: list[Any], ...):
    """Classify a column using in-memory sample values (Task #8 Decision 1)."""
    # sample_values is passed in-memory from profile_column_task
    # Never persisted to DB
    confidence = compute_value_pattern_confidence(sample_values)
    ...
```

This handoff is designed but not implemented here — Task #3 owns the classification step. The
`profile_column_task` result includes `sample_values` so Task #3 can receive them via Celery's
`chord()` callback.

## Dependencies

- Task #1 (`CatalogTable`/`CatalogColumn` rows must exist before profiling).
- Task #8 (PII data-safety decisions — **completed**, decisions documented in that file).
- Task #3 (classification receives sample_values in-memory from this task).

## Edge cases

- **No tables discovered:** If `POST /profile` is called before discovery, return 400 with
  "Run discovery first." The endpoint checks `CatalogTable` count.
- **Column with all NULLs:** `null_rate = 1.0`, `distinct_count = 0`, `min_value = None`,
  `max_value = None`, `sample_values = []`. This is valid — the column exists but has no data.
- **Column with unsupported type (JSON, BLOB, GEOMETRY):** `MIN/MAX` fails, caught and recorded
  as `error` on the result. `null_count` and `null_rate` still work (COUNT works on any type).
  `distinct_count` may be skipped if the connector deems it too expensive.
- **Table with 0 rows:** `total = 0`, `null_rate = 0.0` (division by zero guard), all other
  metrics are `None` or `0`. The profile is still created — it's valid metadata.
- **Connection deleted mid-profile:** The task re-queries the connection at execution time. If
  deleted, returns "skipped" gracefully.
- **Concurrent profile requests:** Two `POST /profile` calls for the same connection create
  duplicate tasks. The `db.merge(profile)` upserts on `column_id`, so the second write
  overwrites the first. This is acceptable — profiling is idempotent.
- **Very large number of columns (10,000+):** The fan-out creates one Celery task per column.
  With 10,000 columns across 500 tables, that's 10,000 tasks. Celery handles this scale
  naturally, but the result backend may see pressure. The `group()` primitive collects results
  efficiently. If this becomes a problem, add a `MAX_CONCURRENT_COLUMN_TASKS` setting that
  limits the group size and processes in batches.

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/test_profiling.py -v
```

- Test that `profile_column` on a table with data returns correct `null_count`, `null_rate`,
  `distinct_count`, `min_value`, `max_value`.
- Test that `profile_column` on an all-null column returns `null_rate = 1.0`.
- Test that `profile_column` on an empty table returns `null_rate = 0.0` with no errors.
- Test that `profile_column` on a JSON/BLOB column degrades gracefully (MIN/MAX = None, error
  recorded).
- Test that `profile_column_task` persists a `ColumnProfile` row with aggregates only (no
  `sample_values` in DB).
- Test that `profile_connection_task` fans out correctly and returns the right counts.
- Test that `POST /profile` without prior discovery returns 400.
- Test that `POST /profile` with a valid connection returns a `task_id`.
- Test that the sample limit config is respected (override env var, verify query LIMIT changes).
- Test that the shared-credential warning is logged once per connection, not per column.
- Performance: time a profile run against a 100-column seeded table; confirm ≤ 60s (NFR).

## Risk

**Medium.** The main risk is SQL injection via column/table names in the profiling queries.
Mitigation: column and table names come from the catalog (trusted metadata from
`information_schema`), not from user input. However, defense-in-depth requires using the
dialect's identifier quote method and parameterized queries for the LIMIT value. The second
risk is performance impact on the source database — mitigated by the bounded sample limit
(1,000 rows) and the distinct scan cap (100,000 rows). The third risk (PII leakage) is
addressed by Task #8's decisions: sample values are never persisted, and the deployment
guide requires database-level encryption at rest.