# Bug #19 — Low-priority cleanup batch from the 2026-07-06 review (LOW)

**Found by:** 2026-07-06 code review of commit `3866c7e`. Individually small; batched so none
get lost.

## Items

1. **Dead code:** `PipelineCRUD.get_run` has no route and its `run.__dict__` spread leaks
   `_sa_instance_state`. Remove it — Task #6 re-adds the single-run read path properly when
   runs actually exist. (FR6's run-detail API is therefore *not* implemented today; INDEX
   correction in Bug #13 reflects that.)
2. **Unused imports** in `pipeline_service.py` (`os`, `sqlite3`, `deque`, `SessionLocal`,
   `AIService` — verify against the restored legacy code from Bug #12 before removing) and in
   `pipelines.py` router (`ScheduleUpsert`, `RetryPolicyUpsert` — keep only if Task #4/#5 land
   imminently; otherwise remove). Also orphaned `CONFIDENCE_THRESHOLD` if the restored legacy
   executor doesn't use it.
3. **`enabled = Column(Integer)`** on `Pipeline`/`Schedule`: use SQLAlchemy `Boolean`
   (SQLite-compatible; stored as int anyway). Drop the `1 if enabled else 0` dance in
   `update_pipeline`.
4. **`Pipeline.schedules` list vs 1:1 reality:** `Schedule.pipeline_id` is `unique=True` and
   the read schema is singular `schedule` — make the relationship `uselist=False` (named
   `schedule`) like `retry_policy`, before Task #4 wires it and hits the mismatch.
5. **`GET /{id}/drift` side effects:** GET writes an audit row + commits and opens a live
   connection to the source DB, and is open to viewers. Decision (record here): acceptable —
   audit-on-read is an existing platform pattern and viewers running a read-only schema fetch
   is within role intent. Revisit if source-DB load becomes a concern.
6. **Role-gating has zero API-level test coverage** for pipelines (all 25 tests are
   service-level; `require_role` on create/update/delete is never exercised). Task #8's own
   stated risk was "forgetting to gate a newly-added endpoint". → Added to Task #10's scope
   explicitly; not fixed in this batch.

## Verify

`pytest tests/pipelines/ -v` still green; `git grep -n "get_run" backend/app` returns only
Task #6's spec reference.

## Risk

Minimal; item 3 is a model change but tables are dev-stage (`create_all`, no migration
framework in play) and `Boolean` round-trips existing 0/1 values on SQLite.
