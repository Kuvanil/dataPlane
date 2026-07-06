# Task #3 — Classification service + confidence scoring (SI-T3)

**TRD reference:** FR3, AC2, §8 External Dependency (classification model/embedding service).

**Current state:** PARTIAL. `SecurityService.classify_column()`
(`backend/app/services/security_service.py:4-48`) is pure column-**name** substring matching
against two fixed keyword lists (High/PII: `email, phone, number, ssn, password, cc, credit, card`;
Medium/Sensitive: `name, zip, city, address, state, birth, date_of`), returning `label`, `level`,
`policy`, `color`, and a `dama_metadata` block. **There is no `confidence` field anywhere in the
return dict.** `classify_schema()` (lines 50-63) just maps this across all columns — no
aggregation, no model, no inspection of actual row values. It's exposed synchronously via
`GET /api/v1/schema/{id}/classify` (`backend/app/api/routers/schema.py:37-61`), recomputed on
every call, nothing persisted. `docs/DAMA_Compliance.md` doesn't define a concrete PII taxonomy
beyond what's already in code — no new categories to reconcile against.

**[?] Open scoping question — resolve before implementing:** AC2's example ("a column containing
email-*formatted values*... classified as 'Email (PII)' with a confidence score") describes
value-based detection, not name-based. The current implementation would classify a column named
`contact` containing email addresses as "Public" (no keyword match) and a column named
`email_backup_unused` containing empty strings as "PII, High confidence" — both wrong under AC2's
actual intent. Two honest paths forward:
1. **Ship confidence-on-keyword-match now**: assign a confidence score to the existing name-based
   heuristic (e.g. exact keyword match = 0.9, substring match = 0.6) and persist it. Fast, matches
   FR3's literal text, but doesn't satisfy AC2's example.
2. **Wait for Task #2** and add value-pattern detection (regex over `ColumnProfile.sample_values`
   or a small inline sample query) so a column's *content* — not just its name — drives the PII
   category and a real confidence score (e.g. `% of sampled values matching the email regex`).
   This is what AC2 actually demonstrates, but depends on #2 landing first (or duplicating a
   sampling query here, which would fight #2's sample-minimization work rather than reuse it).

Recommend implementing (1) immediately as a strict improvement over today's "no confidence at
all," and layering (2) on top once #2 exists, rather than blocking all classification improvement
on #2's completion.

## Scope

### Models — extend `backend/app/models/schema_catalog.py` (Task #1)

- `ColumnClassification` — `id`, `column_id` (FK → `CatalogColumn`), `label`, `level`,
  `confidence` (float, 0.0–1.0), `method` (`"keyword"` | `"value_pattern"`, so #2's later
  value-based results are distinguishable from the name-based baseline, not silently overwritten
  with no record of which method produced which row), `classified_at`. Persisting this (vs. the
  current recompute-on-every-request model) is also the prerequisite for Task #7's override
  mechanism — there has to be a row to override.

### Service — `backend/app/services/security_service.py`

Add `confidence` to `classify_column()`'s return dict per the scoring above. Keep the function's
existing signature/keyword lists unchanged (no behavior change to the categorization logic itself
in this task, only the added confidence number) — this keeps the change reviewable and avoids
conflating "add confidence" with "change what counts as PII," which is a separate, more sensitive
decision.

### Router — extend `backend/app/api/routers/schema.py` or new `schema_catalog.py` (Task #1)

Persist classification results from `GET /{id}/classify` into `ColumnClassification` instead of
(or in addition to) returning them live, so Task #4's search/filter and Task #7's override have
real rows to work against.

## Dependencies

- Task #1 (`CatalogColumn` to attach classifications to).
- Task #2 (for the value-pattern half only — not blocking for the keyword+confidence half).

## Verify

```bash
cd backend && .venv/bin/pytest tests/schema_catalog/test_classification.py -v
```
- A column named `email` with no data → classified PII, confidence reflects keyword-match method.
- (Once #2 lands) a column named `contact` whose sampled values are email-formatted → reclassified
  PII via `value_pattern` method, confidence reflects match rate.

## Risk

Medium. The keyword+confidence half is low-risk (additive field, no behavior change to existing
categorization). The value-pattern half carries the same sample-data-handling risk as Task #2 —
don't implement inline sampling here independent of #2's sample-minimization decision from Task #8.
