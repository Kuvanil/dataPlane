# Schema Mapper Review — Task Index

> Source: `requirements-specs/REVIEW_NOTES_Schema_Mapper.md` (Principal Architect review, 41.8 KB)
> Scope: backend `mapping_*` + frontend schema-mapper + tests + docs
> Verdict: **Approve with Required Changes** — 6 critical, 3 high, 1 medium, plus test additions

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision — see CONTRADICTIONS.md)

## Priority order (top → bottom)

| # | Severity | Status | Title |
|---|---|---|---|
| 1 | CRITICAL | [x] | Register AI-suggestion task with Celery worker — `3897503` |
| 2 | CRITICAL | [x] | Produce `lossy_warning` verdict (FR7/AC3 fix) — `bcd2968` |
| 3 | CRITICAL | [x] | Validate identifiers in `cast.to` and `lookup.*` (SQL-injection surface) — `afe6279` |
| 4 | CRITICAL | [x] | Close N:N bypass in `accept_suggestion` — `950d124` |
| 5 | CRITICAL | [x] | Hoist `match_schemas` out of column loop (O(columns × tables) → O(tables × tables)) — bundled in `3897503` |
| 6 | CRITICAL | [x] | Remove `commit()`/`rollback()` from `record_audit` — `e170786` (SAVEPOINT isolation) |
| 7 | HIGH | [x] | Surface connector-load errors instead of fabricating data — `050122a` (see CONTRADICTIONS.md C2 process note) |
| 8 | HIGH | [x] | Add pagination to list endpoints — done 2026-07-03 |
| 9 | HIGH | [!] | Tenant isolation — flagged to Security/Compliance, no code change (CONTRADICTIONS.md C4) |
| 10 | MEDIUM | [x] | Add narrowing checks within type families — done 2026-07-03 |
| T | test | [x] | Celery registration, SQL-injection surface, FR3 bypass tests landed with #1/#3/#4; publish-race test landed with C5; pagination tests landed with #8 |
| C | review | [x] | Contradictions resolved — see `CONTRADICTIONS.md` (C1/C3/C6/C7/C8 done, C2 confirmed retroactively, C4 deferred to Security, C5 done as of 2026-07-03) |

**Item #8 (pagination) — completed 2026-07-03:**
- `backend/app/schemas/mapping.py`: added `MappingListResponse` / `SuggestionListResponse`
  (`{items, total, limit, offset, has_more}`), wired as `response_model=` on `GET /mappings/`
  and `GET /mappings/{id}/suggestions`.
- `backend/app/api/routers/mappings.py`: dropped the stray unused `from sqlalchemy import func`
  import left over from the in-progress work.
- `backend/tests/mapping/test_mappings_router.py`: updated `test_list_mappings_returns_list` for
  the new envelope shape, added `test_list_mappings_pagination_params` (limit/offset/has_more,
  no overlap between pages).
- `backend/tests/mapping/test_e2e_smoke.py`: updated steps 6 and 12 to unwrap `.items`.
- Frontend: `lib/types.ts` gained a `Paginated<T>` type. `MappingList.tsx` now fetches
  `PAGE_SIZE=50` at a time with a "Load more" button and a total count in the header, instead of
  requesting everything unbounded. `hooks/useMapping.ts` gained a `fetchAllSuggestions()` helper
  (requests the server's max page size, 200, since the suggestion panel wants "every pending
  suggestion" in one shot, not a browsable page) used at all four call sites that previously
  expected a bare array.
- Verified: `pytest backend/tests/mapping/` — 93/93 passing. `npx tsc --noEmit` — clean.
  `npm run build` — compiles, all 16 static pages generate successfully.
- Known limit, not fixed here: a single mapping with >200 unmapped target columns at once (20%
  of the TRD's 1,000-column scale ceiling) would need real pagination in the suggestion panel
  too — noted in a comment in `useMapping.ts` rather than built out speculatively.

**Item #10 (type-narrowing checks) — completed 2026-07-03:**
- `backend/app/services/mapping_validation_service.py`: added `_INT_RANK` / `_FLOAT_RANK` tables
  (TINYINT < SMALLINT < INTEGER/INT < BIGINT; REAL < FLOAT < DOUBLE/DECIMAL/NUMERIC) and extended
  `_is_lossy()` to flag narrowing *within* a family (e.g. `BIGINT → SMALLINT`, `DOUBLE → REAL`),
  which plain family-matching couldn't see — both sides collapsed to `"int"` / `"float"` and fell
  through to the same-family "ok" branch regardless of direction. Widening (`SMALLINT → BIGINT`)
  and same-rank pairs (`DECIMAL → NUMERIC`) are unaffected and remain `ok`. Since `lossy_warning`
  already exists as a verdict (task #2), narrowing-without-cast now warns instead of silently
  passing, consistent with every other lossy case; a `cast` still makes it `ok`; a null-safety
  issue on top still escalates to `blocking`, same as the existing lossy rules.
- `backend/tests/mapping/test_mapping_validation_service.py`: added 8 tests — narrowing without
  cast warns (int and float family), narrowing with cast is ok, widening stays ok, same-rank
  stays ok, and narrowing + nullable-source-into-NOT-NULL-target escalates to blocking.
- Verified: `pytest backend/tests/mapping/` — 100/100 passing (was 93; net +7 after folding in
  the 8 new tests here).

## Execution plan (auto mode)

Working top → bottom in priority order. Each CRITICAL fix:
- Edit source.
- Add or update a focused test that would have caught the bug.
- Run `pytest tests/mapping/ -v` after each fix; must remain 69+/69+.
- Commit with `fix(mapping): …` (or `feat(mapping): …` for new functionality).

After all 6 CRITICAL fixes land, run the full mapping suite, then proceed to HIGH, then MEDIUM. The test addition task (T) is interleaved with each fix — each fix lands WITH its test, not after.

## Manual review (CONTRADICTIONS.md)

Items where the reviewer's recommendation conflicts with an earlier design decision or with a cross-cutting concern that needs human judgment. These are flagged but NOT auto-implemented; they wait on product/security sign-off. See `CONTRADICTIONS.md`.

## Out-of-scope (not implemented here)

- Whole-app tenant isolation (review #9) — the mapping module does not own this; it's a cross-cutting concern. Flagged to Security/Compliance; no code change unless product decides to introduce a `tenant_id` column app-wide.
- Prometheus/OpenTelemetry metrics (review §9) — a separate observability epic.
- CI smoke check that starts a real Celery worker and asserts task registration (review §10) — recommended but lives in a CI/CD epic, not in this branch.
