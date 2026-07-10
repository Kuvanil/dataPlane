# Audit Trail (DP-AUDIT-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Audit_Trail.md` (8 FRs, 8 subtasks, ~30 days estimated = ~6 weeks).
> Scope: Centralized tamper-evident audit log ingestion, canonical event schema, append-only storage with hash-chain integrity, searchable/filterable viewer, export (CSV/JSON), configurable retention, role-gated access, correlation tracing.
>
> **2026-07-09 audit:** The codebase has a basic foundation — `AuditLog` model (`backend/app/models/audit.py`) with `id`, `event_type`, `actor`, `connection_id`, `connection_name`, `payload` (JSON), `status`, `duration_ms`, `created_at`. The `record_audit` helper (`backend/app/services/audit_helper.py`) writes events with SAVEPOINT isolation. The `audit.py` router (`backend/app/api/routers/audit.py`) has `GET /audit/` (paginated list with basic filters), `GET /audit/summary` (aggregate counts), and `GET /audit/{id}` (single event). What's **missing from the TRD**:
>
> - No canonical event schema/contract — the current payload is unstructured JSON.
> - No tamper-evidence — storage is standard SQL, no hash chaining.
> - No append-only enforcement — nothing prevents edit/delete of events through direct DB access.
> - No export endpoint (CSV/JSON).
> - No role-gated access to the audit viewer.
> - No retention policy enforcement.
> - No correlation ID field on the model.
> - No search/filter beyond basic event_type/connection_id/status.
> - No audit viewer UI in the frontend.
>
> **FR1–FR9 verdict (as of 2026-07-09):**

| FR | Requirement | Verdict | Task(s) |
|----|-------------|---------|---------|
| FR1 | Accept events from all modules via common ingestion API | **PARTIAL** — `record_audit` is called by connectors but no canonical schema/contract exists | AUDIT-T1, AUDIT-T2 |
| FR2 | Append-only storage, no edit/delete | **NOT DONE** — no append-only enforcement at API or DB level | AUDIT-T3 |
| FR3 | Tamper-evidence (hash chaining) | **NOT DONE** — no hash chain or integrity verification | AUDIT-T3 |
| FR4 | Search/filter by actor, module, action, target, date range | **PARTIAL** — basic filters exist but limited; no actor/target/module fields | AUDIT-T1, AUDIT-T4 |
| FR5 | Export filtered results as CSV/JSON | **NOT DONE** — no export endpoint | AUDIT-T6 |
| FR6 | Configurable retention policy | **NOT DONE** — no retention enforcement | AUDIT-T7 |
| FR7 | Role-gated access to audit viewer | **NOT DONE** — no role gating on audit endpoints | AUDIT-T7 |
| FR8 | Correlation ID for multi-step tracing | **NOT DONE** — no correlation_id field | AUDIT-T1 |

**0 of 8 FRs fully done; 2 partially done; 6 not done.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — needs human input on design choice

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_canonical_event_schema_contract.md) | FR1, FR8, §11 Data model | [ ] | Canonical event schema + SDK/contract — define the canonical AuditEvent schema, create shared SDK for modules, add correlation_id/before_after/target/module fields |
| [02](02_ingestion_api_durable_buffering.md) | FR1, Reliability NFR, §11 API | [ ] | Ingestion API + durable buffering — `POST /audit/events` endpoint, durable queue-backed ingestion, event validation, backpressure |
| [03](03_append_only_store_tamper_evidence.md) | FR2, FR3, Security NFR | [ ] | Append-only store + tamper-evidence — hash chain implementation, append-only enforcement, integrity verification API |
| [04](04_search_filter_query_layer_indexing.md) | FR4, Performance NFR | [ ] | Search/filter query layer + indexing — full search/filter API, faceted search, date range queries, correlation tracing, partitioned indexing for scale |
| [05](05_viewer_ui_detail_correlation_tracing.md) | FR4, Usability NFR | [ ] | Viewer UI + detail + correlation tracing — frontend audit log viewer, event detail view, correlation trace visualization, filter UI |
| [06](06_export_csv_json.md) | FR5 | [ ] | Export CSV/JSON — export endpoint for filtered results, streaming export for large result sets |
| [07](07_retention_policy_role_gating.md) | FR6, FR7 | [ ] | Retention policy + role gating — configurable retention, automated cleanup, role-gated access to viewer/export |
| [08](08_tests.md) | §12 DoD | [ ] | Tests — immutability, tamper-evidence, ingestion, search, export, retention, role gating |
| [09](09_security_compliance_signoff.md) | Security NFR, §12 DoD | [ ] | Security/compliance sign-off — tamper-evidence validation, retention verification, role gating audit |

## Confidence per task

- **#1 Event schema** — HIGH confidence. Pydantic model definition, straightforward.
- **#2 Ingestion API** — MEDIUM confidence. Durable buffering with backpressure needs careful design. Message queue integration.
- **#3 Tamper-evidence** — MEDIUM confidence. Hash chain is well-understood but the verification mechanism needs thought. Append-only enforcement needs DB-level constraints.
- **#4 Search/filter** — MEDIUM confidence. Indexing strategy for millions of events needs planning.
- **#5 Viewer UI** — MEDIUM confidence. Standard data table with filters, but correlation tracing visualization adds complexity.
- **#6 Export** — HIGH confidence. Streaming export is standard.
- **#7 Retention** — MEDIUM confidence. Cleanup needs careful batching to avoid performance impact.
- **#8 Tests** — MEDIUM confidence. Tamper-evidence tests are non-trivial.
- **#9 Security sign-off** — [!] Cross-reference.

## Execution order (recommended)

1. **#1 Event schema** — foundation: define the canonical event structure every module will emit.
2. **#2 Ingestion API** — build the ingestion endpoint. Depends on #1.
3. **#3 Tamper-evidence** — core integrity mechanism. Can proceed in parallel with #2 once schema is defined.
4. **#4 Search/filter** — query layer on top of stored events.
5. **#5 Viewer UI** — frontend, depends on #4.
6. **#6 Export** — depends on #4 (query layer) and #5 (trigger from UI).
7. **#7 Retention** — depends on #3 (tamper-evident storage) and #4 (query layer for identifying expired events).
8. **#8 Tests** — incremental.
9. **#9 Security sign-off** — cross-team.

## Progress log

- 2026-07-09 — Initial audit against TRD. INDEX.md created with 9 task files. 0/8 FRs fully done. Basic audit logging exists (AuditLog model + record_audit helper + list/summary endpoints) but lacks tamper-evidence, canonical schema, correlation IDs, export, retention, role gating, and a viewer UI.