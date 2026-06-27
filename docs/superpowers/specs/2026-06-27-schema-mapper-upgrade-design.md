# Schema Mapper Upgrade — Data Layer + API Design

> **Scope (confirmed):** This design upgrades the Schema Mapper module to TRD `DP-SM-001` FR1–FR12 coverage **at the data layer and API surface only**. The frontend (Accept/Reject UI, transformation editor, autosave, versioning controls) is intentionally out of scope for this iteration and will follow in a separate spec.

> **Prompts alignment is intentionally out of scope** for this iteration (per user direction). The `prompts/` files are not modified here.

---

## 1. Goal

Replace the stateless `POST /api/v1/mapper/*` endpoints with a persistent, versioned, audited, role-gated mapping workspace that produces an immutable published mapping artifact consumable by the Pipelines module.

## 2. Non-Goals

- No frontend UI changes in this iteration (Visual/English/SQL tabs remain as-is on the legacy `/mapper/*` routes).
- No changes to existing schemas, pipelines, query, agent, askdata, autopilot routers.
- No new external dependencies.
- No modifications to `/prompts/`.

## 3. Functional Coverage (mapped to TRD FRs)

| TRD FR | Implementation surface |
|---|---|
| FR1 — side-by-side panels | (Already in UI) now backed by `/api/v1/mappings/{id}/canvas-data` |
| FR2 — drag-to-connect | `POST /api/v1/mappings/{id}/edges` |
| FR3 — 1:1 and N:1, block N:M | Enforced in `MappingService.add_edge` (multiple sources per target allowed; multiple targets per source is blocked at the DB constraint and the service layer) |
| FR4 — AI suggestions with confidence | `POST /api/v1/mappings/{id}/suggestions` (Celery task) |
| FR5 — Accept / Reject | `POST /api/v1/mappings/{id}/suggestions/{sid}/accept`, `/reject` |
| FR6 — Inline transformations | `PUT /api/v1/mappings/{id}/edges/{eid}/transformation` + `TransformationGrammar` AST |
| FR7 — Type compatibility | `POST /api/v1/mappings/{id}/validate` (lossless / lossy / blocking) |
| FR8 — Save as draft | `POST /api/v1/mappings` + `PUT /api/v1/mappings/{id}` (any time) |
| FR9 — Publish gating + immutable versions | `POST /api/v1/mappings/{id}/publish` (admin only, blocking errors = 0) |
| FR10 — JSON export for Pipelines | `GET /api/v1/mappings/{id}/export` |
| FR11 — Audit events | `record_audit()` called on every state change |
| FR12 — Role gating | `require_role("admin", "analyst")` and `require_role("admin")` deps |

## 4. Data Model (new tables)

```
DBConnection (existing)
   ▲                ▲
   │ source_id      │ target_id
   │                │
Mapping ───────────┬────────────────────────────────────────┐
 id PK             │                                        │
 name              │                                        │
 source_id FK      │                                        │
 target_id FK      │                                        │
 status enum       │  draft | published                      │
 current_version_id FK → MappingVersion.id (nullable)       │
 created_by, created_at, updated_at                          │
                                                            │
MappingVersion ◄────────────────────────────────────────────┘
 id PK, mapping_id FK
 version_number int (1-indexed per mapping)
 status draft | published | archived
 published_at, published_by
 schema_snapshot JSON (source + target schema at publish time)
 edges_snapshot JSON (immutable copy of FieldMapping rows)
 UNIQUE (mapping_id, version_number)

FieldMapping
 id PK, mapping_id FK, version_id FK (nullable while in draft)
 target_table, target_column, target_type, target_nullable, target_is_pk
 sources JSON  -- [{table,column,type}, ...]  (1..N entries)
 transformation JSON  -- {kind, ...}  -- matches TransformationGrammar AST
 origin enum  -- manual | ai_accepted | english_parsed
 ai_confidence float (nullable)
 audit JSON    -- {created_by, created_at, updated_by, updated_at}
 UNIQUE (version_id, target_table, target_column)  -- one mapping per target col per version

AISuggestion
 id PK, mapping_id FK
 target_table, target_column, target_type
 source_table, source_column, source_type
 confidence float (0..100)
 reason text
 status enum  -- pending | accepted | rejected
 accepted_edge_id FK → FieldMapping.id (nullable)
 created_at, decided_at, decided_by
```

Notes:
- `FieldMapping` has no row-level uniqueness across `(version_id)` for sources because N:1 mappings may exist. Uniqueness is on target column within a version.
- `MappingVersion` carries an immutable `edges_snapshot` so published artifacts cannot be silently mutated by future draft edits.
- `Mapping.current_version_id` always points at the latest **published** version. Drafts live in `FieldMapping` rows where `version_id IS NULL`.

## 5. Type-Compatibility Matrix

Implemented by `MappingValidationService.validate_mapping()`. For each edge:

| Source → Target | Verdict |
|---|---|
| same type family (e.g. `TEXT` ↔ `VARCHAR`) | `ok` |
| `INTEGER` → `BIGINT`, `TEXT` → `VARCHAR(N)` | `ok` |
| `TEXT` → `INTEGER` (without CAST) | `blocking` |
| `INTEGER` → `TEXT`, `FLOAT` → `INTEGER` (without CAST) | `lossy_warning` (becomes `blocking` if no `cast(...)` transformation present) |
| `TIMESTAMP` → `DATE` | `lossy_warning` |
| target `NOT NULL` and source `NULLABLE` (without `default` or `null_if`) | `blocking` |
| target `PRIMARY KEY` and multiple sources or nullable source | `blocking` |

Verdict summary: `{ blocking_count, warning_count, ok_count, edges: [{edge_id, verdict, message}] }`. Publish returns 422 if `blocking_count > 0`.

## 6. Restricted Transformation Grammar

Implemented by `TransformationGrammar.parse(payload: dict) -> AST`. Allow-listed function set; no arbitrary code execution; no string interpolation of user data into SQL.

Allowed `kind` values and their JSON shape:

| kind | JSON shape | Notes |
|---|---|---|
| `direct` | `{}` | No transformation |
| `cast` | `{from: str, to: str}` | Type cast |
| `concat` | `{parts: [{kind:"literal",value:str} \| {kind:"source"}]}` | String concat |
| `substring` | `{source_index:int, start:int, length:int}` | substring on N:1 mapping source by index |
| `coalesce` | `{fallback_kind:"literal", fallback_value:str}` | NULL → fallback |
| `upper` | `{}` | String upper |
| `lower` | `{}` | String lower |
| `trim` | `{}` | Trim whitespace |
| `default` | `{value_kind:"literal", value:any}` | Default for NULL |
| `null_if` | `{equals:any}` | Source → NULL if matches |
| `lookup` | `{table:str, key_column:str, value_column:str, default:any}` | Static lookup table reference; the lookup table must be a registered auxiliary table in the system (validated at publish time) |

Input format: a structured JSON body (no freeform DSL). Internally each AST node has `kind`, payload, and a `compile_sql(target_dialect)` method that emits safe, parameterized SQL fragment using positional placeholders.

## 7. Service Layer

- `TransformationGrammar.parse(payload)` → AST; raises `GrammarError` with structured `{kind, message, location}`.
- `TransformationGrammar.validate(ast)` → re-validates AST after persistence (defense in depth).
- `MappingValidationService.validate_mapping(mapping, target_schema)` → returns verdict summary.
- `MappingService`:
  - `create_mapping(source_id, target_id, name, actor)` → draft + audit `mapping_created`.
  - `get_mapping(mapping_id, version_pin=None)` → returns mapping with edges.
  - `update_mapping_meta(mapping_id, name, actor)` → audit `mapping_meta_updated`.
  - `delete_mapping(mapping_id, actor)` → soft delete (set `deleted_at`), audit `mapping_deleted`. Only on draft.
  - `add_edge(mapping_id, edge_input, actor)` → enforces 1:1 / N:1, validates edges, audit `mapping_edge_added`.
  - `remove_edge(mapping_id, edge_id, actor)` → audit `mapping_edge_removed`.
  - `update_edge_transformation(mapping_id, edge_id, transformation, actor)` → parses + validates, audit `mapping_edge_updated`.
  - `generate_suggestions(mapping_id, actor)` → enqueues Celery task, returns `task_id`, audit `mapping_suggestions_requested`.
  - `accept_suggestion(mapping_id, suggestion_id, actor)` → creates FieldMapping, marks suggestion, audit `ai_suggestion_accepted` (with confidence score).
  - `reject_suggestion(mapping_id, suggestion_id, actor)` → marks suggestion, audit `ai_suggestion_rejected`.
  - `validate(mapping_id, actor)` → returns verdict, audit `mapping_validated`.
  - `publish(mapping_id, actor)` → requires admin; validates; creates immutable MappingVersion; sets `current_version_id`; audit `mapping_published`.
  - `export_json(mapping_id, version_id)` → returns published artifact JSON; audit `mapping_exported`.

## 8. Router

`/api/v1/mappings` — full coverage. Role gates:
- `viewer`: `GET` only
- `analyst`: read + write + AI suggestions + validate
- `admin`: all of the above + publish + delete

Every endpoint calls `record_audit(...)` with payload `{before, after, summary, ...}` where applicable.

## 9. Audit Event Taxonomy (additions)

| event_type | When |
|---|---|
| `mapping_created` | new draft |
| `mapping_meta_updated` | rename |
| `mapping_deleted` | soft delete |
| `mapping_edge_added` | edge created |
| `mapping_edge_removed` | edge deleted |
| `mapping_edge_updated` | transformation edited |
| `mapping_suggestions_requested` | Celery task enqueued |
| `mapping_suggestions_ready` | Celery task completed |
| `ai_suggestion_accepted` | user accepted (payload includes confidence) |
| `ai_suggestion_rejected` | user rejected |
| `mapping_validated` | validate endpoint hit |
| `mapping_published` | new version created |
| `mapping_exported` | export endpoint hit |

## 10. JSON Contract for Pipelines (`GET /mappings/{id}/export`)

```json
{
  "mapping_id": 42,
  "name": "CRM → DW Customer Sync",
  "version": 3,
  "status": "published",
  "published_at": "2026-06-27T10:11:12Z",
  "published_by": "admin@dataplane.ai",
  "source": { "connection_id": 1, "name": "CRM_Source_Analytics", "type": "sqlite" },
  "target": { "connection_id": 2, "name": "Data_Warehouse_Target", "type": "sqlite" },
  "field_mappings": [
    {
      "id": "fm_19",
      "origin": "ai_accepted",
      "ai_confidence": 0.92,
      "target": { "table": "dw_customers", "column": "contact_email", "type": "VARCHAR", "nullable": false, "primary_key": false },
      "sources": [{ "table": "crm_users", "column": "email_address", "type": "TEXT", "nullable": true }],
      "transformation": { "kind": "cast", "from": "TEXT", "to": "VARCHAR" },
      "audit": { "created_by": "admin@dataplane.ai", "created_at": "...", "updated_by": "admin@dataplane.ai", "updated_at": "..." }
    }
  ],
  "schema_snapshot": { "source": { /* captured at publish time */ }, "target": { /* captured at publish time */ } }
}
```

Detailed contract: `docs/mapper-mapping-contract.md` (delivered in this iteration).

## 11. Errors

- `422` validation errors carry `{detail: [{loc, msg, type}, ...]}` (FastAPI default).
- `403` for role denials.
- `404` for missing mapping / edge / suggestion.
- `409` for state conflicts (e.g. publish on already-published version, edge on non-draft).
- `422` (custom) for grammar violations: `{detail: {kind: "grammar_error", message, location}}`.
- `422` (custom) for blocking validation errors: `{detail: {kind: "validation_blocking", blocking_count, edges: [...]}}`.

## 12. Acceptance Criteria (this iteration)

- [ ] All listed tables exist; migrations are auto-applied by `Base.metadata.create_all`.
- [ ] All endpoints listed in §7 are implemented and return correct status codes.
- [ ] Grammar accepts all 11 allowed kinds and rejects everything else with a structured error.
- [ ] Validation matrix produces correct verdicts on a fixture of 10 type combinations.
- [ ] Publish blocks when `blocking_count > 0`; succeeds and creates immutable MappingVersion otherwise.
- [ ] Viewer role cannot create / modify / publish (403).
- [ ] Every state-changing call emits an `AuditLog` row with correct `actor`, `payload`, and `status`.
- [ ] `GET /mappings/{id}/export` returns the documented JSON shape.
- [ ] Tests: ≥ 1 unit test per service method, ≥ 1 integration test for create→suggest→accept→publish→export, ≥ 1 test for each role denial.

## 13. Open Questions

None — all decisions resolved in scope discussion.
