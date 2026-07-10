# Task #6 — History + saved queries (QS-T6)

**TRD reference:** FR5, FR6 (§4).

**Current state:** `QueryHistory` model exists with per-query logging including `natural_query`, `generated_sql`, `method`, `confidence`, `row_count`, `error`, `report_type`, `connection_name`. However, this is NL-to-SQL specific and doesn't track general SQL execution. No `SavedQuery` model or feature exists.

## Scope

Build per-user query history viewer and saved queries feature: save a query with a name, reload it into the editor, browse history with search, and manage saved queries.

### Data model — `backend/app/models/query_history.py` (extend) + `SavedQuery` (new)

Extend `QueryHistory` to support direct SQL execution:
- `sql` (the SQL text — already present as `generated_sql`)
- `connection_id` (FK to connections)
- `result_row_count` → from existing `row_count`
- `execution_time_ms` (new)
- `status` (completed, failed, cancelled)
- `executed_by` (user identity)
- `statement_type` (select, insert, etc.)

New model `SavedQuery`:
```python
class SavedQuery(Base):
    __tablename__ = "saved_queries"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    sql = Column(Text, nullable=False)
    connection_id = Column(Integer, ForeignKey("connections.id"))
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)
    is_deleted = Column(Boolean, default=False)
```

### API endpoints

- `GET /query/history?page=1&page_size=50` — Paginated history with optional filters (connection, date range, statement type).
- `POST /query/saved` — Save current query with a name: `{ "name": "...", "sql": "...", "connection_id": int }`.
- `GET /query/saved` — List saved queries for the current user.
- `GET /query/saved/{id}` — Get a single saved query (to load into editor).
- `PUT /query/saved/{id}` — Update saved query name/SQL.
- `DELETE /query/saved/{id}` — Soft delete a saved query.

### Frontend — History/Saved panels

- **History panel** — Collapsible sidebar or tab showing recent queries with SQL preview, connection name, timestamp, status icon.
- **Saved queries panel** — List of saved queries with load, rename, delete actions.
- **Save button** — In the toolbar, opens a save dialog (name input).
- **Load** — Clicking a history or saved query entry loads the SQL + connection into the editor.

### Dependencies

- **QS-T1** — execution creates history entries.
- **QS-T4** — editor loads SQL from history/saved queries.

## Verify

- History records each query execution with full metadata.
- Save and load a named query.
- History search/filter works.
- Deleted saved queries are hidden.

## Risk

Low. Standard CRUD patterns. The main effort is the UI for browsing and managing queries.