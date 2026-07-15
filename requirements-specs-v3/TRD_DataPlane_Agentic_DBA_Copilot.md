# Task Requirement Document

## 1. Task Overview

- **Task ID:** DP-ADBA-001
- **Task Name:** Agentic DBA Copilot — Multi-Step Schema Design, Data Quality & Transformation Planning
- **Summary:** Extend AskData/Query Workspace to recognize complex, build-oriented DBA requests
  ("create new target schemas for X based on profiling, with data quality steps, transformations,
  and final target tables") as a distinct capability from read-only NL-to-SQL, and handle them via
  a multi-step, human-reviewed **plan → approve → execute** pipeline that reuses this repo's
  existing execution surfaces (Schema Mapper, Query Studio's write path, Pipelines, Autopilot's
  governance model) instead of a parallel, ungoverned mechanism.
- **Business Objective:** Let DBAs/analysts ask for non-trivial schema/ETL design work in plain
  English on a recurring basis, with varying domains and phrasing, and get a real, reviewable
  artifact back — not a meaningless default query — while keeping every DDL/mapping/execution step
  inside the audit and approval gates this platform already requires for those actions.

---

## 2. Origin

A user asked, in `/dashboard/query-workspace` (Ask mode): *"create new target schemas for retail
analytics in postgresql based on profiling ensure to create proper data quality steps,
transformations and final target tables"* and received a trivially wrong answer. Root-caused
(2026-07-14 audit, see `agentic_dba_tasks/INDEX.md` for full citations):

- `NL2SQLService.generate_sql` (`backend/app/services/nl2sql_service.py`) has **no intent
  classification** — it only ever tries to produce a `SELECT`. When no template/heuristic keyword
  matches, its fallback is literally `SELECT * FROM {tables[0]} LIMIT 50;` — which is what fired
  here, since the request matches none of the recognized read-query keywords.
- This is not a fixable bug in the existing pipeline — it's a scope boundary working as designed.
  `askdata_pipeline_service.ask()` explicitly refuses to execute anything that isn't a classified
  `SELECT` (safety gate, by design, per the original AskData TRD's read-only NFR). AskData was
  built to be a read-only Q&A surface and should stay that way.
- What's missing is a **second capability** for build-oriented requests, wired into the same chat
  surface but routed to a different, appropriately-governed pipeline — not a loosening of AskData's
  existing safety boundary.

---

## 3. Scope

### In-Scope

- Intent classification ahead of NL2SQL generation: distinguish "answer a question about existing
  data" from "design/build new schema objects, data quality rules, or transformations" before
  generation is attempted, so an out-of-scope request gets a clear response instead of a bogus
  query (Task #1 — smallest, highest-value, ships independently of everything else below).
- A structured, reviewable **`SchemaDesignPlan`** artifact: proposed target tables/columns, DQ
  rules (justified by real profiling numbers), transformations (expressed in Schema Mapper's
  existing transformation grammar), and generated DDL — always presented for human review before
  anything executes.
- Reuse of existing execution surfaces for every side effect: DDL executes through Query Studio's
  existing admin+confirm write path; mappings are created as ordinary **draft** Schema Mapper
  mappings the user reviews/edits/publishes exactly like a manually-created one; a governance
  action (`schema_design_create`) is registered in Autopilot's existing allow-list/approval
  pattern, approval-only (never auto-executed), consistent with that registry's existing explicit
  prohibition on autonomous `ddl_execute`.
- Profiling enrichment (uniqueness ratio, duplicate sampling, FK-candidate inference) so "based on
  profiling" is a real, defensible claim, not decoration on top of today's null-rate/min-max-only
  profile.
- An extensible intent registry so future varying requests (different domains, different request
  shapes — "add a DQ check to table X," "propose an index for slow query Y") are added as new
  handlers, not hardcoded logic for "retail analytics" specifically.
- A clarifying-question flow for ambiguous/unsupported requests (missing source connection,
  ambiguous domain, no profiling yet) — ask, don't guess.

### Out-of-Scope

- Any autonomous execution of DDL or mapping publication without an explicit human approval step —
  this is a hard non-negotiable, not a phase-2 relaxation (see Risks §10).
- Multi-tenant scoping of generated schemas/plans — depends on the tenant-isolation architecture
  decision already deferred elsewhere in this repo (`requirements-specs/tenant_isolation_tasks/00_architecture_decision.md`);
  this epic must not be the place that first resolves or silently ignores that gap (Task #11).
- Rewriting AskData's existing read-only NL2SQL path — it stays exactly as-is for read queries.
- A general-purpose free-form agent that can take arbitrary actions beyond the specific
  plan-artifact types this TRD defines (target schema, DQ rules, transformations). Expansion to
  new artifact types is future work, enabled by Task #10's registry but not built out here.
- Non-relational/streaming targets — scope is the existing supported connector dialects
  (Postgres/MySQL/SQLite/Oracle, matching `SqlEditor`'s existing `DIALECTS` map).

---

## 4. Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner | _TBD_ | Plan-review UX, approval workflow policy |
| Tech Lead | _TBD_ | Planning-engine architecture, integration boundaries |
| ML/AI Engineer | _TBD_ | Metadata-grounded domain-modeling prompt design, eval harness |
| Backend Engineer | _TBD_ | Planning engine, registry action, execution wiring |
| Frontend Engineer | _TBD_ | Plan-card UX in Query Workspace |
| Security | _TBD_ | Approval-gate sign-off, tenant-isolation cross-reference |
| QA Engineer | _TBD_ | Verification, eval harness across varied domains |

---

## 5. Functional Requirements

- **FR1:** The system shall classify an incoming AskData request's intent (read-query vs.
  build/design request) before attempting NL-to-SQL generation.
- **FR2:** On a build/design intent, the system shall generate a `SchemaDesignPlan` grounded in the
  Schema Intel catalog and profiling data for the relevant connection(s), not in row-level data
  content.
- **FR3:** The plan shall include proposed target tables/columns, data-quality rules justified by
  real profiling statistics, and column-level transformations expressed in the existing
  `TransformationPayload` grammar.
- **FR4:** The plan shall be rendered for human review in the Query Workspace chat as a structured
  artifact (not prose), with explicit approve/edit/reject actions per artifact (schema, DQ rules,
  transformations).
- **FR5:** On approval, the proposed DDL shall execute only through the existing Query Studio
  write-execution path (role-gated, explicit confirmation, fully audited) — no new execution
  engine.
- **FR6:** On approval, a **draft** Schema Mapper mapping shall be created from the plan's proposed
  transformations, entering the existing draft → validate → publish lifecycle unchanged.
- **FR7:** The system shall detect collisions with existing schema objects and offer a migration
  (`ALTER`) path instead of blindly re-creating, reusing the existing migration-SQL generation
  precedent.
- **FR8:** The system shall ask a clarifying question rather than guess when the source connection,
  domain, or required profiling data is missing or ambiguous.
- **FR9:** Every stage (intent classified, plan generated, plan approved/rejected/edited, DDL
  executed, mapping created) shall emit a distinguishable audit event.
- **FR10:** The intent-classification and plan-generation logic shall be structured as an
  extensible registry, not hardcoded per-domain logic, so new request types can be added later.

---

## 6. Non-Functional Requirements

- **Performance:** Plan generation is not required to be as fast as read-query NL2SQL (~seconds is
  fine); long-running generation should run as an async task with a status the chat UI can poll,
  not block the request thread.
- **Security:** No autonomous DDL/mapping-publish execution under any policy setting — this mirrors
  Autopilot's existing explicit `PROHIBITED_ACTION_TYPES` entry for `ddl_execute`, not a new
  decision. Plan generation grounds only in metadata/profiling, never row-level data content (same
  principle Autopilot's engine already enforces, for the same prompt-injection-safety reason).
- **Reliability:** DDL application is tracked per proposed object (table-by-table), so a partial
  failure reports exactly what succeeded/failed rather than an opaque all-or-nothing result.
- **Usability:** A rejected or edited plan should be revisable in the same chat session (multi-turn
  iteration), not a one-shot take-it-or-leave-it generation.
- **Scalability:** Domain-modeling prompts must stay within a bounded context window regardless of
  catalog size — summarize/paginate catalog grounding rather than dumping an entire large schema
  into a single prompt.

---

## 7. Task Breakdown / Subtasks

See `agentic_dba_tasks/INDEX.md` for the full task list (12 tasks), confidence notes, execution
order, and progress log — this TRD is the design record; that INDEX is the working tracker, per
this repo's established spec-driven-epic convention.

---

## 8. Acceptance Criteria

**AC1 — Out-of-scope request no longer returns a meaningless query**
- **Given** a request like the retail-analytics example above
- **When** it reaches AskData
- **Then** the system classifies it as a build/design intent and does not attempt NL2SQL
  generation against it.

**AC2 — Plan is grounded and reviewable, not silently executed**
- **Given** a classified build/design request with an identifiable source connection
- **When** the planning engine runs
- **Then** a `SchemaDesignPlan` is produced and shown for review; nothing executes without an
  explicit approval action.

**AC3 — Approved DDL executes only through the existing gated path**
- **Given** an approved plan
- **When** its DDL is applied
- **Then** execution happens via Query Studio's existing write-execution service (role + confirm
  gated, audited) — confirmed by code path, not merely by claim.

**AC4 — Collision produces a migration option, not a duplicate-create failure or silent overwrite**
- **Given** a plan whose proposed table name already exists
- **When** the plan is reviewed
- **Then** the system offers an `ALTER`-based migration path instead.

**AC5 — Ambiguous request triggers a clarifying question**
- **Given** a request missing a resolvable source connection or domain
- **When** classified
- **Then** the system asks a clarifying question rather than guessing.

**Checklist**
- [ ] Intent classification gate ships and is covered by tests for both intents.
- [ ] SchemaDesignPlan model + deterministic-first planning engine implemented.
- [ ] Profiling enrichment (uniqueness, duplicates, FK candidates) implemented.
- [ ] Plan-review UX ships in Query Workspace.
- [ ] DDL execution reuses Query Studio's path; no parallel executor introduced.
- [ ] Draft mapping auto-creation feeds the existing Schema Mapper lifecycle.
- [ ] Collision/migration handling implemented.
- [ ] Clarifying-question flow implemented.
- [ ] Audit events emitted at every stage.
- [ ] Tenant-isolation cross-reference recorded, not silently bypassed.
- [ ] Security sign-off obtained before any execution path is enabled in production.

---

## 9. Dependencies

**Internal:** Schema Intel (catalog + profiling grounding), Schema Mapper (transformation grammar,
draft/validate/publish lifecycle), Query Studio (gated DDL/write execution), Autopilot (governance
registry pattern, approval-queue precedent), Pipelines (optional downstream execution once a
mapping is published), Audit Trail, the still-unresolved Tenant Isolation architecture decision.
**External:** LLM/generation service (Ollama, same as existing NL2SQL/Autopilot integration).

---

## 10. Assumptions

- A discovered, classified, and at least partially profiled schema exists for the source
  connection(s) implied by the request — if not, the system asks the user to scan/profile first
  rather than guessing from structural metadata alone.
- The existing Autopilot governance pattern (allow-list, risk/reversibility gating,
  approval-queue) is the right model to extend, rather than building a new authorization framework.
- Domain-specific schema modeling (e.g., "what should a retail analytics schema contain") is
  inherently judgment-laden and will use LLM assistance grounded strictly in metadata, with a
  deterministic template library as a starting point/fallback for common, recognizable domains —
  not purely freeform generation every time.

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM proposes an unreasonably large/wrong schema | High | Sanity caps (max tables/columns per plan), template-first for recognized domains, mandatory human review before execution |
| DDL execution partially fails mid-plan | Medium | Per-object apply tracking (mirrors Pipeline's per-step run tracking), clear partial-success reporting |
| Autonomous execution creep (someone later flips a "just auto-apply" flag) | High | Registry action `schema_design_create` hardcoded `auto_capable=False`, matching the existing `ddl_execute` prohibition — treat as a non-negotiable, not a config toggle |
| Prompt injection via profiled data content | Medium | Ground generation only in metadata/profiling statistics, never row-level values — same principle Autopilot's engine already enforces |
| Tenant isolation gap extends into a new schema-creation surface | High | Explicit cross-reference to the existing deferred architecture decision; do not silently proceed as if resolved |
| Thin profiling produces low-confidence DQ rules | Medium | Task #2 enriches profiling first; plan clearly flags rule confidence, doesn't assert false certainty |

---

## 12. Technical Notes

- **New service:** `agentic_dba_engine` (or similar) producing `SchemaDesignPlan` objects — no new
  execution engine; execution delegates to `query_execution_service` (DDL) and `mapping_service`
  (draft mapping creation), exactly as they exist today.
- **New registry action:** `schema_design_create` in `autopilot_registry.py`'s `ACTION_SPECS`
  (or equivalent), `auto_capable=False`, `risk="high"`, `reversible=False` — approval-only,
  mirroring `migration_execute`'s existing precedent.
- **Reused grammar:** `TransformationPayload`/`ALLOWED_KINDS` from `transformation_grammar.py` —
  no new transformation DSL.
- **Reused precedent:** the legacy `_create_target_on_the_fly`/`generate_migration_sql` code path
  (`pipeline_service.py`, `schema_mapper_service.py`) is the closest existing analog for
  "generate DDL from a match/diff and gate its execution" — study before building a parallel
  mechanism; extend or replace it deliberately, don't duplicate it.
- **APIs (indicative):** `POST /askdata/ask` gains an intent-classification pre-step (no route
  change); new `POST /agentic-dba/plan` (generate), `GET /agentic-dba/plans/{id}`,
  `POST /agentic-dba/plans/{id}/approve`, `POST /agentic-dba/plans/{id}/reject`.

---

## 13. Definition of Done

- [ ] Code completed and reviewed.
- [ ] Unit/integration tests passing; eval harness covers multiple domains, not just retail.
- [ ] FR1–FR10 implemented and verified.
- [ ] Security sign-off on the approval-gate design and tenant-isolation cross-reference.
- [ ] Acceptance criteria met.
- [ ] Documentation updated; `MEMORY.md` and this epic's `INDEX.md` progress log current.
