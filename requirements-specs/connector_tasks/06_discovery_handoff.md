# Task #6 — Schema discovery handoff to Schema Intel (CONN-T6)

**TRD reference:** FR8, §11 API: `POST /connectors/{id}/discover`.

**Current state:** `backend/app/api/routers/connectors.py` has `GET /connectors/{id}/schema` that calls `SchemaService.get_full_schema()` and returns the raw schema dict. There is no explicit "discovery handoff" — the endpoint is synchronous, returns data to the caller, and does not persist anything. Schema Intel (the catalog) has its own `POST /api/v1/catalog/scan/{connection_id}` endpoint (see `requirements-specs/schema_intel_tasks/01_catalog_data_model_and_discovery.md`) but there is no connector-orchestrated handoff to it.

## Scope

Build a `POST /connectors/{id}/discover` endpoint that:
1. Fetches the schema from the connector.
2. Stores a schema snapshot (for Drift Detection — reusing the existing `SchemaSnapshot` model in `backend/app/models/schema_snapshot.py`).
3. Triggers the Schema Intel catalog scan if available (gracefully degrades if not).
4. Returns the discovered schema + scan status.

### New endpoint — `POST /connectors/{id}/discover`

```python
@router.post("/{id}/discover")
def discover_schema(id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Trigger schema discovery: fetch, snapshot, and hand off to Schema Intel."""
    db_conn = _get_or_404(id, db)

    # 1. Fetch schema via existing connector pipeline
    from app.services.schema_service import SchemaService
    try:
        schema_data = SchemaService.get_full_schema(db_conn)
    except Exception as e:
        logger.error("Schema discovery failed for connector %d: %s", id, e)
        record_audit(db, "discovery_failed", connection_id=id, connection_name=db_conn.name,
                     payload={"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Schema discovery failed: {str(e)}")

    # 2. Store snapshot (reuse existing SchemaSnapshot model)
    from app.models.schema_snapshot import SchemaSnapshot
    snapshot = SchemaSnapshot(
        connection_id=id,
        schema_hash=_compute_schema_hash(schema_data),
        schema_json=schema_data,
        captured_at=datetime.utcnow(),
    )
    db.add(snapshot)
    db.flush()

    # 3. Handoff to Schema Intel catalog (best-effort, don't fail if unavailable)
    catalog_scan_id = None
    try:
        # Attempt to call Schema Intel's scan endpoint internally
        from app.services.schema_catalog_service import scan_connection
        catalog_scan_id = scan_connection(db, id, actor="discovery-handoff")
        db.flush()
    except ImportError:
        logger.info("Schema Intel catalog service not available — skipping catalog scan")
    except Exception as e:
        logger.warning("Schema Intel catalog scan failed (non-fatal): %s", e)

    # 4. Audit
    table_count = len(schema_data)
    record_audit(db, "discovery_completed", connection_id=id, connection_name=db_conn.name,
                 payload={"tables": table_count, "snapshot_id": snapshot.id,
                          "catalog_scan_id": catalog_scan_id})

    db.commit()
    return {
        "id": id,
        "name": db_conn.name,
        "tables": table_count,
        "snapshot_id": snapshot.id,
        "catalog_scan_id": catalog_scan_id,
        "tables_discovered": list(schema_data.keys()),
    }
```

### Schema hash function

For drift detection, compute a deterministic hash of the schema structure (not the data):

```python
import hashlib, json

def _compute_schema_hash(schema: dict) -> str:
    """Deterministic hash of table/column structure for drift comparison."""
    # Sort for deterministic output regardless of DB response order
    normalized = json.dumps(schema, sort_keys=True, default=str)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]
```

### Integration with existing drift detection

The `SchemaSnapshot` model is already used by the drift detection system (`backend/app/tasks/ai_tasks.py`'s `_check_single_connection_drift`). By creating a snapshot here, the next drift check will compare against this new snapshot as the baseline, rather than against the previous snapshot (or creating a "first snapshot" with no baseline). This means:

- First discovery → creates snapshot (no drift event, baseline established).
- Second discovery → creates snapshot, drift check compares against baseline, emits DriftEvent if changed.

The existing `rescan` endpoint (`/api/v1/schema/{id}/rescan` in `schema.py`) does something similar but returns the diff. This endpoint should not duplicate that — it's a "discovery handoff" that *stores* the result, not a "rescan" that *diffs*.

### Synchronous vs async

The current design is synchronous: the user waits for the schema to be fetched. For large schemas (thousands of tables), this could take tens of seconds. If latency becomes a problem:

1. Make the endpoint accept a `?async=true` query parameter.
2. If async, dispatch a Celery task and return `202 Accepted` with a `task_id`.
3. The frontend can poll `GET /tasks/{task_id}` for completion.

Start synchronous; add async support when the need is demonstrated.

### Existing GET /schema endpoint

The existing `GET /connectors/{id}/schema` should remain as-is for ad-hoc schema inspection (e.g., Schema Mapper's inline schema picker). The new `POST /connectors/{id}/discover` is the explicit "I want to persist this and trigger downstream processing" action.

## Dependencies

- `SchemaSnapshot` model (already exists in `backend/app/models/schema_snapshot.py`).
- `SchemaIntel` catalog service (`backend/app/services/schema_catalog_service.py` from `schema_intel_tasks/01`). If it doesn't exist yet, the task degrades gracefully.
- Task #1 (audit emission on discovery).

## Edge cases

- **Schema Intel not available:** The catalog scan call is wrapped in a try/except. If `schema_catalog_service` doesn't exist (hasn't been built yet), import fails and the handoff is skipped. Log this at info level, not warning — it's an expected state during phased rollout.
- **Discovery while another discovery is in progress:** Two simultaneous discovers for the same connection could create duplicate snapshots. Mitigation: check if there's an un-drifted snapshot from the last 60 seconds for this connection, and skip if so (return the existing snapshot). Or use a simple lock per connection ID.
- **Empty schema (no tables):** A valid connection that has no tables (e.g., a newly created database) should succeed, returning `tables_discovered: []` with `tables: 0`. This is not an error.
- **Connection deleted after discovery starts:** Rare race. The `_get_or_404` at the start ensures the connection exists; if deleted mid-discovery, the snapshot is orphaned. Orphaned snapshots (no matching `DBConnection`) are cleaned up by the drift system's next full scan.
- **Large schemas:** If the schema has 10,000 columns across 500 tables, `schema_json` becomes a large JSON blob. The `SchemaSnapshot` model stores it as a JSON column — ensure the database supports the size (SQLite has a 1GB limit per row, Postgres has no practical limit for JSONB). If this becomes a problem, compress the JSON before storing and decompress on read.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that `POST /connectors/{id}/discover` creates a `SchemaSnapshot` row.
- Test that the returned `tables_discovered` matches the actual schema.
- Test that a second discover after a schema change detects drift (via subsequent `rescan` or drift check).
- Test that discovery on an empty schema (no tables) succeeds with `tables: 0`.
- Test that discovery on a deleted connection returns 404.
- Test that discovery emits audit events (`discovery_completed` on success, `discovery_failed` on error).
- Test graceful degradation when Schema Intel service is unavailable (no crash, logs info).

## Risk

Low. This is primarily orchestration — fetch, persist, notify. The main risk is the Schema Intel handoff failing silently (masking a real problem). Mitigated by logging the failure at info level (expected) vs warning (unexpected but non-fatal). The audit event records whether the handoff succeeded.