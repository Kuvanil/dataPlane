# Agentic DBA Copilot (DP-ADBA-001) — Task Index

> Source: `requirements-specs-v3/TRD_DataPlane_Agentic_DBA_Copilot.md`.
> Triggered by a real user report: asking Query Workspace's Ask mode — *"create new target
> schemas for retail analytics in postgresql based on profiling ensure to create proper data
> quality steps, transformations and final target tables"* — returned a meaningless default query.
> This is a **net-new capability**, not a gap-closure pass against an existing TRD.

## 2026-07-14 root-cause + reusability audit (full citations)

**Why AskData returned garbage:** `POST /api/v1/askdata/ask` → `askdata_pipeline_service.ask()`
(`backend/app/services/askdata_pipeline_service.py:117-186`) delegates generation entirely to
`NL2SQLService.generate_sql()` (`nl2sql_service.py:49-124`), which has **no intent classification**
— it's a strict fast-path-template → LLM(SELECT-only prompt) → heuristic-fallback chain. The
heuristic fallback (`_heuristic_generate`, lines 175-197) picks `tables[0]` and returns
`SELECT * FROM {table} LIMIT 50;` when no keyword matches — exactly what fired here, since the
request matches none of the recognized read-query keywords. This is not a bug to patch in place:
`askdata_pipeline_service.ask()` explicitly refuses to execute anything that isn't a classified
`SELECT` (lines 156-160) — a deliberate, correct safety gate from the original AskData TRD. The fix
is a **second, differently-governed capability**, not loosening this one.

**Reusable pieces already in this codebase** (study before building anything new):
- **Schema Mapper's transformation grammar** (`transformation_grammar.py:16-19`) —
  `direct/cast/concat/substring/coalesce/upper/lower/trim/default/null_if/lookup`. Pure column-value
  transforms; nothing expresses row-level DQ rules (dedup/uniqueness/range checks). Mapper strictly
  requires an **existing** target table (`mapping_service.py:141-213`); AI suggestions
  (`mapping_tasks.py:35-199`) only match to columns already present in a connected destination —
  never propose brand-new ones.
- **Autopilot's governance pattern** (`autopilot_registry.py:186-270`) — allow-listed actions with
  `risk`/`reversible`/`auto_capable` flags; `PROHIBITED_ACTION_TYPES` (lines 235-243) **already
  explicitly bans `ddl_execute`, `mapping_publish`, `credential_change`** from ever being
  auto-executed, enforced default-deny regardless of policy. Decision path is confirmed
  LLM-free (no Ollama references anywhere in `autopilot_engine.py`/`autopilot_service.py`) —
  rationale is metadata-only, explicitly to avoid prompt injection via data content. This is the
  **existing precedent to extend**, not a new authorization model to invent.
- **Pipelines' data model** (`pipeline.py:24-70,162`) — `extract|transform|load` staged execution
  against an already-**published** mapping; no DDL stage, no validate stage. A **legacy** executor
  in the same service (`pipeline_service.py:418-526`, marked "will be replaced") already does
  `_create_target_on_the_fly` (`CREATE TABLE IF NOT EXISTS`, SQLite-only) — the closest existing
  analog to "generate target DDL from a match," but narrow and slated for replacement, not a
  foundation to build on directly.
- **Query Studio's write path** (`statement_classifier.py:26,31`, `query_execution_service.py:38-87`) —
  the classifier already distinguishes `DDL` from `INSERT/UPDATE/DELETE`, but execution lumps them
  into one `WRITE_TYPES` gate. **DDL is reachable today**: admin + `confirm=true` runs a plain
  `CREATE TABLE` with no special DDL review. This is the execution path Task #7 must reuse — not
  replace.
- **Schema Intel profiling** (`schema_catalog.py:86-113`) — `null_count/null_rate/distinct_count/
  min_value/max_value/sample_size_used` only. No histograms, no FK inference, no real uniqueness
  verification (`distinct_count` exists but nothing computes a distinct/row-count ratio or compares
  it across tables). Too thin to honestly ground "based on profiling" claims as-is — Task #2 closes
  this gap.
- **Existing multi-step precedent:** `run_autopilot_task`'s migration flow
  (`ai_tasks.py:457-458+`) already chains extract → AI-match → diff → PII-classify → generate
  migration DDL (`schema_mapper_service.py:186-253`, emits real `ALTER TABLE` DDL) → gated execution
  behind the approval-only `migration_execute` action. This is the closest prior art for a chained,
  dependent, human-gated plan — deterministic/rule-based, single-purpose (migration only). The new
  planning engine generalizes this pattern, it doesn't reinvent it.

## Design decisions & edge cases (read before implementing any task below)

1. **Plan → approve → execute, always. No autonomous execution, ever, under any policy setting.**
   This is the single load-bearing decision everything else depends on. It is not a cautious
   starting point to relax later — Autopilot's own registry already hard-bans `ddl_execute` from
   auto-execution; this epic's new `schema_design_create` action must be `auto_capable=False` from
   day one and stay that way. A future request to "just auto-apply trusted plans" is a new product
   decision requiring its own sign-off, not an incremental toggle on this epic's work.
2. **Every execution side-effect goes through an existing gate — no parallel executor.** DDL
   executes via Query Studio's existing write path (role + `confirm=true`, audited). Mappings are
   created as ordinary drafts in Schema Mapper's existing draft→validate→publish lifecycle. This
   epic is a *planning* and *routing* layer on top of infrastructure that already exists and is
   already governed — resist the temptation to build a dedicated "agentic DBA executor."
3. **Ground generation in metadata/profiling only, never row-level data content.** Same principle
   Autopilot's engine already enforces and for the same reason (prompt injection via data the
   model wasn't meant to treat as instructions). A domain-modeling LLM call sees table/column
   names, types, classifications, and profiling statistics — never sampled row values.
4. **Ambiguity → clarifying question, never a guess.** Missing/ambiguous source connection, domain
   that doesn't map to any known template or catalog content, or a connection with no profiling
   yet — all of these should produce a follow-up question in chat, mirroring the AskData TRD's
   existing "ask a clarifying question rather than guessing" NFR, not a best-effort guess dressed
   up as a confident plan.
5. **Collision detection is mandatory, not a nice-to-have.** If a proposed table name already
   exists, silently re-issuing `CREATE TABLE` is wrong (fails outright or, worse on some dialects,
   silently no-ops) and silently dropping/overwriting it is dangerous. The plan must detect this
   and offer a migration (`ALTER`) path instead, reusing `schema_mapper_service.generate_migration_sql`'s
   precedent rather than inventing new diffing logic.
6. **Per-object apply tracking, not one opaque all-or-nothing execution.** A plan proposing 5
   tables where table 3 fails to create must report exactly that, not silently roll back
   everything or silently continue past the failure. Mirror `PipelineRunStep`'s per-step tracking
   model (`extract|transform|load`) — track per proposed schema object here the same way.
7. **Tenant isolation is out of scope to solve here — but must not be silently ignored either.**
   This repo has an existing, deliberately deferred architecture decision at
   `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (referenced by six prior
   epics per `MEMORY.md`'s log — mapper, schema intel, connectors, dashboard, autopilot, and the
   original schema-mapper review). A new schema-*creation* surface is exactly the kind of gap that
   decision was meant to close before it got worse — Task #11 cross-references it explicitly rather
   than quietly building on top of an unresolved gap, becoming epic number seven to flag the same
   thing.
8. **Dialect-aware DDL generation, not Postgres-only**, even though the triggering example said
   "in postgresql" — reuse the same `DIALECTS`-style mapping `SqlEditor.tsx` already has for syntax
   highlighting, so the same planning engine works across the platform's actually-supported
   connector types.
9. **Async plan generation, not a blocking chat request.** Read-query NL2SQL is fast; multi-step
   domain modeling grounded in a potentially large catalog is not. Generation should run as a
   background task (Celery, consistent with existing `nl2sql_task`/autopilot task patterns) with
   the chat UI polling/showing a "plan generating…" state, not a long-held HTTP request.
10. **Plans are stateful and editable across a chat session**, not one-shot. A user should be able
    to say "actually drop the `products` table from that plan" as a follow-up turn and get a
    revised plan, not have to restate the whole request. Ties into AskData's existing
    session/conversation-context handling.
11. **Deterministic templates first, LLM judgment second.** For recognizable domains (start with a
    small library — e.g. a generic retail/e-commerce star-schema template), use a template as the
    starting draft so results are reproducible and reviewable against a known shape; use the LLM to
    adapt the template to the actual discovered catalog (real column names/types/classifications),
    not to invent the domain shape from nothing on every call. Sanity-cap the LLM's proposal size
    (max tables/columns per plan) regardless.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Title | Status | Depends on |
|---|---|---|---|
| [01](01_intent_classification_gate.md) | Intent classification gate in AskData — stop the silent garbage-query fallback | [x] | — |
| [02](02_profiling_enrichment.md) | Profiling enrichment: uniqueness ratio, duplicate sampling, FK-candidate inference | [x] | — |
| [03](03_schema_design_plan_engine.md) | `SchemaDesignPlan` model + deterministic-first planning engine (template + LLM-assisted) | [x] | #1, #2 |
| [04](04_data_quality_rule_proposal.md) | Data-quality rule proposal derived from real profiling statistics | [x] | #2, #3 |
| [05](05_transformation_proposal.md) | Transformation proposal using the existing `TransformationPayload` grammar | [x] | #3 |
| [06](06_plan_review_ux.md) | Plan-card review UX in Query Workspace (approve/edit/reject per artifact) | [x] | #3, #4, #5 |
| [07](07_gated_ddl_execution.md) | Gated DDL execution via Query Studio's existing write path + new approval-only registry action | [x] | #6 |
| [08](08_draft_mapping_autocreation.md) | Auto-create a draft Schema Mapper mapping from an approved plan | [x] | #7 |
| [09](09_collision_and_migration_handling.md) | Collision detection + migration (`ALTER`) path + per-object apply tracking | [x] | #7 |
| [10](10_extensible_intent_registry.md) | Extensible intent registry + clarifying-question flow | [x] | #1 |
| [11](11_tenant_isolation_and_signoff.md) | Tenant-isolation cross-reference + security/governance sign-off | [!] | #7, #8 |
| [12](12_tests_and_eval_harness.md) | Tests + multi-domain eval harness | [x] | #1–#10 |

## Confidence per task (auto-mode implementation)

- **#1 Intent classification gate** — HIGH confidence. Self-contained addition ahead of the
  existing generation call; the highest-value, lowest-risk fix and should land first regardless of
  how much of the rest of this epic gets built.
- **#2 Profiling enrichment** — MEDIUM-HIGH confidence. Uniqueness ratio and duplicate sampling are
  mechanical given existing connector query capability; FK-candidate inference (value-overlap
  heuristic against other tables' PKs) is more judgment-laden and may need a confidence threshold
  decision.
- **#3 Planning engine** — MEDIUM confidence. The deterministic/template scaffolding is
  straightforward; the LLM-assisted adaptation layer needs careful prompt design to stay
  metadata-only (decision #3) and within a bounded context window (NFR) — the riskiest single piece
  in the epic.
- **#4 DQ rule proposal** — MEDIUM-HIGH confidence, straightforward once #2/#3 exist.
- **#5 Transformation proposal** — HIGH confidence — reuses an existing, well-defined grammar.
- **#6 Plan review UX** — MEDIUM confidence. Frontend work analogous to Autopilot's existing
  approval-queue UI and Query Studio's write-confirm modal — precedent exists, needs adapting to a
  multi-artifact (schema + DQ + transforms) plan rather than one atomic action.
- **#7 Gated DDL execution** — MEDIUM confidence. Wiring to the existing write path is
  straightforward; the new registry action's `auto_capable=False` hardcoding (decision #1) must be
  enforced at import-time the same way `autopilot_registry.py` already asserts it for other
  actions.
- **#8 Draft mapping auto-creation** — MEDIUM confidence, depends on #7's created tables actually
  existing/being queryable before the mapping references them.
- **#9 Collision/migration handling** — MEDIUM-LOW confidence. Reuses `generate_migration_sql`'s
  precedent but needs real design work for per-object partial-failure tracking (decision #6) —
  not a one-line addition.
- **#10 Extensible registry + clarifying questions** — MEDIUM confidence. The registry pattern
  itself is mechanical (mirrors `autopilot_registry.py`); deciding *what* counts as "ambiguous
  enough to ask" is a judgment call worth a light product check-in.
- **#11 Tenant isolation + sign-off** — **`[!]` blocked**, same as every other epic that's hit this
  gap. Do not auto-implement a tenant-scoping shortcut here; cross-reference and wait.
- **#12 Tests + eval harness** — MEDIUM confidence. Deterministic-part unit tests are
  straightforward; a genuinely multi-domain eval set (not just retail) needs real authoring effort,
  not a rubber-stamp single fixture.

## Execution order (in auto mode)

1. **#1 Intent classification gate** — ships independently, fixes the literal reported complaint
   immediately, and everything else builds on the classification it introduces.
2. **#2 Profiling enrichment** — independent of #1, can run in parallel; #3/#4 need it.
3. **#3 Planning engine** — depends on #1 (needs a classified intent to act on) and #2 (needs real
   profiling to ground DQ proposals meaningfully, even if the schema-shape part alone could start
   without it).
4. **#4 DQ rule proposal** and **#5 Transformation proposal** — both depend on #3's plan structure
   existing; independent of each other, can be built in parallel.
5. **#6 Plan review UX** — depends on #3/#4/#5 producing a stable plan shape to render.
6. **#7 Gated DDL execution** — depends on #6 (approval action must exist before execution can be
   wired to it).
7. **#8 Draft mapping auto-creation** and **#9 Collision/migration handling** — both depend on #7;
   independent of each other.
8. **#10 Extensible registry + clarifying questions** — depends only on #1's classification
   existing; can be developed any time after that, in parallel with #2-#9.
9. **#11 Tenant isolation + sign-off** — pursue in parallel once #7/#8 exist enough to review
   concretely; stays `[!]` regardless of when raised.
10. **#12 Tests + eval harness** — last, incrementally added as each piece lands, not held to the
    very end in practice.

## Out of scope (confirmed, per TRD §2)

- Autonomous DDL/mapping-publish execution under any configuration.
- Multi-tenant scoping of generated plans (cross-referenced, not solved, at #11).
- Changes to AskData's existing read-only NL2SQL path.
- A general-purpose free-form action agent beyond the specific artifact types this TRD defines.
- Non-relational/streaming targets.

## Progress log

- 2026-07-14 — Epic scoped from a real user-reported gap. Root-caused AskData's trivial-fallback
  behavior and surveyed reusable infrastructure (Autopilot governance registry, Schema Mapper
  transformation grammar, Pipelines' staged execution model, Query Studio's DDL-capable write path,
  Schema Intel's profiling depth) via direct code audit — citations above. INDEX.md + TRD created,
  12 tasks defined. Not started.
- 2026-07-14 — **Tasks #1–#10, #12 built and verified** (single build session; #11 stays `[!]`).
  - **#1 done.** New `dba_intent_classifier.py` (deterministic keyword/pattern gate — build verbs
    in base form via word-boundary regex, so "orders created today" stays read_query);
    `askdata_pipeline_service.ask()` classifies BEFORE grounding/generation on the raw question
    (not history-augmented text); `askdata.intent_classified` audit event alongside the existing
    `question_answered`; `intent`/`intent_confidence` added to `AskDataAskResponse`. The literal
    retail-analytics user report now short-circuits before NL2SQL (test spies confirm
    `generate_sql` is never called).
  - **#2 done.** `ColumnProfile` gained `row_count`/`uniqueness_ratio`/`duplicate_count`/
    `fk_candidates` (all additive/nullable — **manual dev-Postgres migration needed:**
    `ALTER TABLE column_profiles ADD COLUMN row_count INTEGER; ALTER TABLE column_profiles ADD
    COLUMN uniqueness_ratio FLOAT; ALTER TABLE column_profiles ADD COLUMN duplicate_count INTEGER;
    ALTER TABLE column_profiles ADD COLUMN fk_candidates JSON;`). `ColumnProfileResult` gained
    `row_count`, set in all 5 connectors (each already computed `total` for null_rate). New
    `profiling_enrichment.py`: uniqueness ratio, duplicate counting (aggregate only — sampled
    values never persisted, per Schema Intel Task #8 Decision 1), FK-candidate inference by value
    overlap against declared PKs only, bounded by new settings
    (`SCHEMA_INTEL_FK_MAX_TABLES=25`, `_PK_VALUE_LIMIT=10000`, `_MIN_OVERLAP=0.5`), values
    normalized to strings for cross-type overlap. Wired into `profile_column_task`.
  - **#3 done.** `SchemaDesignPlan` model (persisted, session-tied, JSON artifact columns,
    status lifecycle generating→ready→applying→applied/partially_applied); `agentic_dba_engine.py`
    — template-first (one `retail_analytics` star-schema template; source tables matched by name
    hints, columns copied with `source_refs`), catalog-driven `dw_<table>` fallback, LLM adaptation
    via Ollama that is strictly grounding-validated (identifier regex, source_refs must exist in
    catalog, caps enforced) and falls back to the deterministic proposal with an honest note on ANY
    failure (unreachable/bad JSON/ungrounded); sanity caps (`AGENTIC_DBA_MAX_TABLES=10`,
    `_MAX_COLUMNS_PER_TABLE=30`) with explicit truncation notes; async generation via new
    `agentic_dba_tasks.generate_plan_task` (registered in celery include list); router
    `/api/v1/agentic-dba` (POST /plan 202 + poll GET /plans/{id} + approve/reject).
  - **#4 done.** `dq_rule_proposer.py` — not_null (null_rate ≤1%), unique (uniqueness ≥99%,
    worded "appears unique in the profiled sample… not a full-table guarantee"), foreign_key
    (overlap ≥80%, worded "inferred, not verified"), dedupe (duplicates on a near-unique column →
    load-time step, not a target constraint). Every rule cites the exact number; no profile → no
    rule + explicit note. Thresholds documented in-code as tunable judgment calls.
  - **#5 done.** `transformation_proposer.py` — direct/cast/concat(+" " literal separator, same
    N:1 convention as mapper_tasks#1)/coalesce (nullable source → NOT NULL target) selection from
    the EXISTING grammar; unknown target type or un-castable pair → transformation left None with
    "author manually" note; every emitted payload re-validated through `transformation_grammar.parse`.
  - **#6 done.** `SchemaDesignPlanCard.tsx` in query-workspace (polls 2.5s while
    generating/applying, stops on settled status; collapsible sections for tables/DQ/transforms/
    DDL/notes/apply-results; two-step Approve & Create confirm mirroring WriteConfirmModal's
    weight; per-object apply results with distinct partially_applied state). Wired into
    `AskDataView` as a sibling under the ChatBubble for turns carrying `plan_id`. 7 component
    tests; tsc/lint/build clean.
  - **#7 done.** `schema_design_create` registered in `autopilot_registry.py`
    (`auto_capable=False, risk=high, reversible=False` — passes the existing import-time
    assertions; NOT added to `PROHIBITED_ACTION_TYPES` since that set means "never executable at
    all" while this action is approval-only, same modeling as `migration_execute`).
    `agentic_dba_execution_service.py` executes every statement through
    `query_execution_service.execute(role=admin, confirm=True)` — spy-tested that the real Query
    Studio path is hit; non-admin approval → 403; `agentic_dba.schema_object_created/failed`
    audit per object.
  - **#8 done.** After a fully-applied plan: draft mapping via `MappingService.create_mapping` +
    `add_edge(origin="agentic_dba")` per resolved transformation (unresolved → edge absent, not
    wrong). **Modeling constraint surfaced honestly:** Schema Mapper requires source ≠ target
    connection; same-connection plans skip mapping creation with an explicit confidence note
    (`target_connection_id` added to plan model/API for the distinct-target case).
  - **#9 done.** Collision detection at plan time against the target catalog → `mode: "migrate"`
    ALTER-based DDL (ADD COLUMN; SQLite type changes recorded as comment warnings, matching
    `generate_migration_sql` precedent) with an explicit plan-card distinction; per-object apply
    tracking with stop-on-first-failure → `[applied, failed, skipped]` breakdown and
    `partially_applied` plan status.
  - **#10 done.** Classifier restructured as `IntentSpec` registry (name/matcher/handler/priority;
    `register_intent`/`unregister_intent`; built-ins schema_design + read_query; tests prove a
    third registered intent dispatches without touching the core). Clarifying-question flow:
    schema_design on an unscanned connection → "scan first" ask; ambiguous question naming no
    known table → clarification instead of the old garbage-SQL guess (ambiguous + known table name
    keeps today's read-query behavior — threshold judgment call, flagged for tuning).
  - **#12 done.** `test_eval_harness.py`: 4-domain eval set (retail, healthcare, HR, logistics) —
    all classify schema_design, all produce ready grounded plans with zero ungrounded source_refs;
    non-retail domains provably use the catalog fallback (not a mislabeled retail template); full
    end-to-end test (chat endpoint → plan → approve → real tables in target SQLite → real draft
    mapping with grammar-valid `origin="agentic_dba"` edges); unprofiled-catalog and collision
    eval cases. **Caveat:** LLM-adaptation quality itself is untested offline by design (Ollama
    unreachable in CI — the deterministic fallback is what's verified); a live-Ollama manual pass
    on the 4-domain eval set remains open as the plan-*quality* acceptance bar.
  - Verification: backend `pytest tests/agentic_dba/ tests/askdata/` 81 passed (28 askdata incl.
    9 pre-existing unregressed; 53 agentic_dba+eval); frontend `tsc --noEmit` clean,
    `vitest run` 113/113, `next build` clean. Full-suite regression run recorded below.
- 2026-07-14 — **Full-suite regression pass:** entire backend `pytest tests/` 796/796 green
  (includes all pre-existing suites: connectors 260-series, mapping, pipelines, schema_catalog,
  audit, autopilot, security, semantic, viz — none regressed by this session's three epics).
  Frontend: `tsc --noEmit` clean, `vitest run` 125/125, `next build` clean, `next lint` zero new
  issues. One session-discovered gotcha worth knowing: a live local Ollama makes plan-generation
  tests nondeterministic — `tests/agentic_dba/conftest.py` pins `AGENTIC_DBA_LLM_ENABLED=False`
  and the LLM path has its own mocked-boundary tests instead.
- 2026-07-15 — **Second validation pass — 4 defects fixed, 1 documented; see `bugs2.md` +
  `enhancements2.md`.** Fixed: (BUG-01) `uniqueness_ratio` divided the distinct-scan-capped
  numerator by the full row count, so the UNIQUE/DEDUPE DQ rules silently never fired on tables
  larger than the 100k scan cap — now divides by `min(row_count, scanned_rows)`; (BUG-02) LLM
  column `type` bypassed grounding validation and flowed verbatim into DDL — now validated by
  `_TYPE_RE`, ungrounded type rejects the whole adaptation; (BUG-03) schema-design requests
  naming a SaaS as their data domain ("create target tables for our jira data") were misrouted to
  the ACI approval queue — removed the `external_action` `+1` score bonus and made `schema_design`
  win ties (priority 20 > 10); (BUG-04) concurrent double-approval could double-apply DDL — plan
  row now `SELECT … FOR UPDATE`. Documented (not fixed): SQLite type-change collision object
  reported `applied` though nothing executed. Regression tests added; backend `pytest` 811/811.
