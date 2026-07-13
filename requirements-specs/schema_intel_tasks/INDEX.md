# Schema Intel (DP-SI-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Schema_Intel.md` (8 FRs, 8 subtasks SI-T1–T8, ~29 person-days
> estimated).
> Scope: backend schema-discovery/profiling/classification services + a new persisted catalog +
> `/dashboard/schema` and `/dashboard/security` frontend pages + Celery scan/profile jobs + audit.
>
> **2026-07-06 TRD-vs-implementation audit.** Unlike Pipelines (0/10 FRs done), Schema Intel is
> **not a greenfield build** — three adjacent features already exist and cover part of the TRD:
> live (non-persisted) schema discovery via the Connectors schema endpoint, a working Celery-based
> drift-detection job with `SchemaSnapshot` hash comparison, and a keyword-based PII/DAMA
> classifier on the Security page. None of the three fully satisfies its corresponding FR, and two
> FRs (profiling, catalog search) have no code at all. Per the convention established in
> `mapper_tasks/` and `Pipelines_tasks/`, this directory has one numbered file per task in addition
> to this index, and the original SI-T1–T8 breakdown has been re-scoped against what's actually
> there rather than treated as a from-scratch plan.

## FR1–FR8 verdict (as of 2026-07-06 audit)

| FR | Requirement | Verdict | Task(s) |
|----|---|---|---|
| FR1 | Discover and persist schema structure (tables, columns, types, keys) | **DONE** (2026-07-06) — `CatalogTable`/`CatalogColumn`/`CatalogForeignKey` persist discovery via `POST /api/v1/catalog/scan/{id}`; Postgres/Oracle PK bugs fixed; FK discovery added to all 5 connectors | #1 |
| FR2 | Profile each column: null rate, distinct count, min/max | NOT STARTED — zero profiling code anywhere | #2 |
| FR3 | Classify columns into sensitive categories with a confidence score | PARTIAL — keyword/substring rule engine exists, returns no `confidence` field, never inspects actual data values | #3 |
| FR4 | Search/filter the catalog by table, column, type, classification | PARTIAL — `GET /api/v1/catalog/{id}/tables` (Task #1) lists a connection's persisted catalog, but has no `q`/filter params yet; no UI | #4, #5 |
| FR5 | Manual override of a classification, audited | NOT STARTED — no override endpoint or persisted classification to override, though generic audit infra exists | #7 |
| FR6 | Re-scan + drift detection, highlighting added/removed/changed elements | **DONE** — implemented independently ahead of Task #1 (see progress log): `DriftEvent` model, `POST /api/v1/schema/{id}/rescan`, column-level `GET /{id}/drift-history` | #6 |
| FR7 | Bounded-sample profiling with configurable, enforced sample limits | NOT STARTED — depends entirely on FR2, which doesn't exist | #2 |
| FR8 | Audit events for scans, classifications, and overrides | PARTIAL — `schema_classified`, `schema_drift_detected`, and now `schema_scanned` (Task #1) all emit via `record_audit()`; no override event yet (no override exists) | #7 |

**2 of 8 FRs done (FR1, FR6), 3 partial, 3 not started (profiling and its FR7 dependent, manual
override). Catalog foundation (#1) and drift completion (#6) are both live; profiling (#2) is now
the largest remaining gap.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_catalog_data_model_and_discovery.md) | FR1, AC1, §11 | [x] | Catalog data model + persisted discovery engine |
| [02](02_profiling_jobs.md) | FR2, FR7 | [x] | Profiling jobs (async, bounded samples) — landed 2026-07-13 |
| [03](03_classification_confidence.md) | FR3, AC2 | [x] | Classification service + confidence scoring — landed 2026-07-13, both keyword+confidence AND value-pattern (AC2) halves implemented together |
| [04](04_catalog_search_api.md) | FR4 | [x] | Catalog search API — landed 2026-07-13 |
| [05](05_catalog_ui.md) | FR4, FR5 (UI half) | [ ] | Catalog UI + classification badges |
| [06](06_drift_detection_completion.md) | FR6, AC3 | [x] | Drift detection completion (column-level + on-demand rescan) |
| [07](07_manual_override_and_audit.md) | FR5, FR8 | [x] | Manual override + full audit coverage — landed 2026-07-13 |
| [08](08_pii_data_safety_signoff.md) | Security NFR, §9, §12 DoD | [!] | PII data-safety sign-off (sample minimization, encryption at rest, least-privilege credentials) |
| [09](09_tenant_isolation_signoff.md) | §9 assumption / DoD | [!] | Tenant isolation — cross-reference, not a new task |
| [10](10_tests.md) | §12 DoD | [ ] | Test suite |

## Confidence per task (auto-mode implementation)

- **#1 Catalog data model + discovery** — HIGH confidence for the model/persistence/CRUD
  scaffolding (mirrors the Schema Mapper / Pipelines pattern that already works twice in this
  codebase) and for fixing the two hardcoded-`False` PK bugs (`postgres.py:61`, `oracle.py:111`) —
  those are mechanical, `information_schema`-style queries the other three connectors already do
  correctly. MEDIUM on foreign-key/relationship discovery, since the `BaseConnector` contract has
  no FK concept at all today and each connector's introspection query needs a new column. This is
  the foundation every other task depends on — land first.
- **#2 Profiling jobs** — MEDIUM. No profiling precedent exists anywhere in this codebase (first
  implementation, not a pattern-match, same caution as Pipelines' retry task). The real risk is
  scope: profiling queries (`COUNT(DISTINCT ...)`, `MIN/MAX`, sampling) must be bounded and
  per-connector-safe (a naive `SELECT *` sample on a billion-row table violates the Performance NFR
  and the Security NFR's "minimize sample data" requirement simultaneously). Needs a concrete
  sample-size default before implementation, not left as a TODO.
- **#3 Classification + confidence** — **[?] open.** Mechanically bolting a `confidence` number
  onto the existing keyword match (e.g. `1.0` for an exact keyword hit) is HIGH confidence and
  technically satisfies FR3's letter, but AC2's example — classifying by *inspecting values* (an
  email-*formatted* column, not just one *named* "email") — is a materially different feature
  requiring #2's sampled data plus pattern/regex matching against real values. Auto-implementing
  only the mechanical version risks shipping something that looks done but doesn't do what AC2
  actually demonstrates. Needs a decision: ship confidence-on-keyword-match now (fast, honest about
  its limits) and layer value-based detection on top once #2 lands, or hold #3 until #2 is done.
  The ML/embedding classification service the TRD lists as an external dependency (§8) is out of
  scope for auto-mode entirely — no such service is configured anywhere in this codebase.
- **#4 Catalog search API** — HIGH once #1 exists. Standard filtered-list-endpoint work, same
  shape as the paginated `GET /api/v1/mappings/` and `GET /api/v1/audit/` endpoints already in
  the codebase.
- **#5 Catalog UI** — MEDIUM. This either extends or replaces two existing pages
  (`/dashboard/schema`'s comparison UI, `/dashboard/security`'s classification list, which
  currently hardcodes connection id `1` and has a non-functional "Run Audit Scan" button) — a
  product decision on whether the catalog is a third page or absorbs one of these two is worth a
  quick check before building, same caution Pipelines flagged for its UI rewrite.
- **#6 Drift detection completion** — HIGH-MEDIUM. The hard part (column-level diffing) is
  already implemented and tested via `DiffService.compare_tables`/`compare_schemas` — this task is
  "stop discarding it before persistence" plus adding an on-demand trigger endpoint, not new
  diff logic. Low risk.
- **#7 Manual override + audit** — MEDIUM once #1 and #3 exist (needs a persisted classification
  row to attach an override to — today's classification is recomputed on every request, nothing
  to override). The audit mechanism itself (`record_audit`, `AuditLog`) is proven and reusable.
- **#8 PII data-safety sign-off** — **[!] blocked**, same class as `mapper_tasks/07` and
  `Pipelines_tasks/11`. "Classifications encrypted at rest" and "sample data minimized and not
  persisted beyond profiling" are compliance decisions (which fields, what encryption mechanism,
  how long is "beyond profiling") that need Security sign-off before #2/#3 land, not after —
  building profiling first and retrofitting data-minimization later risks having already leaked
  sample values into logs, audit payloads, or a database column.
- **#9 Tenant isolation** — **[!] blocked**, cross-reference to the same app-wide gap already
  flagged in `mapper_tasks/07_tenant_isolation_signoff.md` and
  `review_schema_mapper_tasks/CONTRADICTIONS.md` §C4. Not re-litigated here; applies equally to
  the new catalog tables once #1 creates them.
- **#10 Tests** — Not a standalone auto-mode task; each task above ships its own tests as part of
  its definition of done (see each task file's Verify section). This entry tracks the rollup.

## Execution order (recommended)

1. **#1 Catalog data model + discovery** — everything else reads from or writes to this.
2. **#6 Drift detection completion** — independent of #2/#3, mechanical, and gives immediate value
   (surfacing already-computed diff data); can run in parallel with #2.
3. **#2 Profiling jobs** — needs #1's catalog rows to attach profile results to. **Do not start
   before #8's sample-minimization decision is made** — the sampling strategy IS the compliance
   question.
4. **#8 PII data-safety sign-off** — pursue in parallel with #1, ahead of #2/#3's implementation,
   not after.
5. **#3 Classification + confidence** — the keyword+confidence half can land alongside #1; the
   value-based half needs #2.
6. **#4 Catalog search API** — needs #1.
7. **#7 Manual override + audit** — needs #1 and #3 (a persisted classification to override).
8. **#5 Catalog UI** — needs #1, #4, and ideally #3, #6 (badges/drift indicators) to have real
   APIs to render.
9. **#9 Tenant isolation sign-off** — cross-team, pursue in parallel; don't block other tasks on
   it but don't mark the catalog "done" without it either.

## Out of scope (confirmed, per TRD §2)

- Establishing the connection itself (owned by Connectors).
- Field-level mapping (owned by Schema Mapper).
- Enforcement/masking policy execution (owned by Security) — Schema Intel classifies; it doesn't
  mask or block.
- Natural-language querying (owned by AskData Bot).
- A hosted ML/embedding classification service (TRD §8 external dependency) — no such service
  exists in this codebase; see task #3's confidence note.

## Progress log

- 2026-07-06 — TRD-vs-implementation audit run. Found three pre-existing partial features
  (live schema discovery, Celery drift-detection, keyword-based DAMA classifier) that the
  original SI-T1–T8 breakdown didn't account for; re-scoped into 10 numbered tasks (adds #8
  PII data-safety sign-off and #9 tenant-isolation cross-reference, neither present in the
  original TRD subtask table, following the same audit pattern that found equivalent gaps in
  `Pipelines_tasks`). No implementation started yet.
- 2026-07-06 — **Task #6 done, discovered mid-implementation of Task #1.** While planning #1,
  found `backend/app/models/drift_event.py`, `_check_single_connection_drift()` in
  `ai_tasks.py`, `POST /api/v1/schema/{id}/rescan`, an updated column-level
  `GET /{id}/drift-history`, and `backend/tests/schema_catalog/test_drift.py` (7 tests) already
  present in the working tree, implemented independently (not by this session) directly against
  this task's own spec. Verified all 7 tests pass; left entirely untouched. FR6/AC3 verdict
  updated to DONE above.
- 2026-07-06 — **Task #1 done.** `backend/app/models/schema_catalog.py`
  (`CatalogTable`/`CatalogColumn`/`CatalogForeignKey`, full-replace-per-table cascade design),
  `backend/app/schemas/schema_catalog.py`, `backend/app/services/schema_catalog_service.py`
  (`scan_connection` — reuses `SchemaService.get_full_schema()`, emits a `schema_scanned`
  audit event; `get_catalog`), `backend/app/api/routers/schema_catalog.py`
  (`POST /api/v1/catalog/scan/{id}` role-gated `admin`/`analyst`, `GET /api/v1/catalog/{id}/tables`
  ungated matching the sibling `schema.router`'s existing convention), wired into `main.py`
  (`/api/v1/catalog`, tag "Schema Catalog" — kept separate from `/api/v1/schema`'s "Schema
  Intelligence" tag to avoid confusion with the pre-existing comparison/classify/drift router).
  Fixed both hardcoded `"primary_key": False` bugs (`postgres.py`, `oracle.py`'s real-Oracle
  branch — the SQLite-simulation branch was already correct) with real
  `information_schema`/`all_constraints` queries, and added foreign-key discovery to all 5
  connectors (Postgres/Oracle: new catalog queries; MySQL: extended the existing query;
  SQLite: `PRAGMA foreign_key_list`; JDBC: `inspector.get_foreign_keys()`). 9 new tests
  (`test_discovery.py` × 6 against a real on-disk SQLite database exercising the actual
  connector, `test_connector_pk_fk.py` × 3 with mocked cursors for Postgres/Oracle since no
  real instance is available in this environment) — all passing, plus the full existing suite
  (148 tests total) unaffected. Task `schema_intel_tasks/01_catalog_data_model_and_discovery.md`
  done.
- 2026-07-13 — **Tasks #2, #3, #4, #7 landed together** (profiling + classification depend on
  each other's output, per Task #3's own recommendation to layer value-pattern detection on top
  of profiling rather than ship keyword-only first). `ColumnProfile` and `ColumnClassification`
  models added to `schema_catalog.py`; `BaseConnector.profile_column()` implemented for all 5
  connectors (SQLite fully per spec, Postgres/MySQL/Oracle-real/JDBC dialect-adapted — bounded
  sample + distinct-scan-limited subquery + MIN/MAX with graceful degradation on unsupported
  types); `app/tasks/schema_intel_tasks.py` fans out profile_connection_task ->
  profile_table_task -> profile_column_task per Task #2's design, classifying each column
  in-memory from its sample immediately after profiling (Task #8 Decision 1: sample_values never
  persisted — confirmed no `sample_values` column exists on `ColumnProfile` and a dedicated test
  asserts this). `SecurityService.classify_column()` now returns `confidence`+`method`
  (keyword exact=0.9/substring=0.6, matching AC2's demonstrated value-pattern classification
  when sample_values are available — email/phone/ssn/credit-card regex at a 60% match-rate
  threshold, verified against a real "contact" column classified as PII purely from content).
  `GET /catalog/{id}/tables` gained `q`/`data_type`/`classification_label` filters (Task #4).
  `PUT /catalog/columns/{id}/classification` (Task #7) persists a manual override that a
  subsequent re-profile does not clobber (dedicated test). 43 new backend tests
  (`test_profiling.py`, `test_classification.py`, `test_catalog_search.py`,
  `test_router_role_gating.py`), full suite 534/534 passing. One model bug caught by the search
  test and fixed: the `ColumnProfile`/`ColumnClassification` -> `CatalogColumn` backrefs needed
  `backref(..., uselist=False)`, not a bare string, or SQLAlchemy defaults the reverse side to a
  list. Frontend Task #5 (catalog UI) landed in the same session — see that task's own file for
  detail — replacing the pre-TRD Schema Matcher at `/dashboard/schema`. Verified live end-to-end
  in Docker: scan discovered 3 real tables/17 columns from the seeded CRM SQLite demo db, profile
  computed real null rates/distinct counts/min-max, `email` classified PII·100% and `ip_address`
  Sensitive·60% from real data, and a manual override persisted and rendered immediately.
