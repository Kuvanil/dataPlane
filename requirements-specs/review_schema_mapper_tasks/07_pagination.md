# Task #7 — Add pagination to list endpoints

**Reviewer finding:** §11.8 (HIGH). `GET /api/v1/mappings/` and
`GET /api/v1/mappings/{id}/suggestions` return unbounded result sets.
At the TRD's NFR "≥10,000 versioned mapping definitions per tenant"
(§5), this endpoint becomes the first thing to fall over, and it's the
one the mapping-list sidebar calls on every page load.

## Changes

### 1. `backend/app/api/routers/mappings.py`
- Add `limit: int = Query(50, ge=1, le=200)` and
  `offset: int = Query(0, ge=0)` to:
  - `GET /` (list_mappings)
  - `GET /{mapping_id}/suggestions` (list_suggestions)
- Response shape: return `{items: [...], total: int, limit: int,
  offset: int, has_more: bool}` instead of a bare list.

### 2. `backend/app/services/mapping_service.py`
- Add `list_mappings(db, *, limit, offset) -> (items, total)` helper that
  applies the limit/offset at the DB level and returns the total count
  in a single query pair (cheap with SQLAlchemy's `func.count`).

### 3. `backend/tests/mapping/test_mappings_router.py`
- Add tests asserting:
  - Default limit is 50.
  - limit=2 returns 2 items with has_more=True when total > 2.
  - offset=N paginates correctly.
  - limit clamped to max=200.

### 4. `frontend/src/app/dashboard/schema-mapper/components/MappingList.tsx`
- Update fetch to pass `limit=100&offset=0`.
- Adapt the state to the new response shape (`data.items`, `data.total`,
  `data.has_more`).
- Render a simple "Load more" button when `has_more === true`.
- Show total count in the header (e.g. "Mappings · 47 total").

## Verify

- `cd backend && .venv/bin/pytest tests/mapping/ -v` — must remain 91+/91+.
- `cd frontend && npm run build` — TypeScript clean.

## Risk

- This is a **breaking change** to the response shape of two endpoints.
  Frontend callers other than `MappingList` (none today) would need to
  adapt. Acceptable since the upgrade is scoped to this module.
- The `total` count is a separate `SELECT COUNT(*)` query per request.
  At the TRD's 10,000-mapping target with indexed `created_at`, this is
  sub-millisecond. Acceptable.
