# Pipelines (DP-PIPE-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Pipelines.md` (10 FRs, 9 subtasks, ~4 weeks estimated).
> Scope: backend `/api/v1/pipelines/*` + frontend `/dashboard/pipelines` + Celery scheduler +
> audit + tests.
>
> **2026-07-06 re-audit:** this INDEX was originally written as a forward-looking phased
> delivery plan *before any pipeline code existed against it*. A TRD-vs-implementation audit run
> today confirms **none of Phase 1, 2, or 3 below has actually been built** — `git log` shows no
> commits touching pipeline files since the initial repository import. The code that exists
> today (`backend/app/services/pipeline_service.py`, `backend/app/api/routers/pipelines.py`,
> `frontend/src/app/dashboard/pipelines/page.tsx`) is the **pre-TRD "Visual Transformation
> Studio"** — a stateless, synchronous, AI-matcher-driven graph executor with no `Pipeline`
> entity, no persistence, no scheduling, no role gating, and no relationship to Schema Mapper's
> published-mapping contract. It is the thing PIPE-T3 is supposed to replace, not a partial
> implementation of the TRD.
>
> This re-audit also found **two TRD requirements with no corresponding subtask** in the
> original PIPE-T1–T9 breakdown (concurrency/queueing NFR, and credential-vaulting sign-off) —
> both are now tracked as tasks #9 and #11 below so they aren't silently dropped.
>
> Per the established convention in `mapper_tasks/` and `review_schema_mapper_tasks/`, this
> directory now has one numbered file per task (`01_...md` – `11_...md`) in addition to this
> index, rather than only a plan document.

## FR1–FR10 verdict (corrected 2026-07-06, see Bug #13)

> **2026-07-06 correction (Bug #13):** the previous revision of this table marked FR3–FR10
> "DONE" when only their *spec files* had been written — no execution engine, scheduler,
> retry, re-run, or run-producing code exists in `backend/app/`. Verdicts below now reflect
> landed, tested code only.

| FR | Requirement | Verdict | Task(s) |
|----|---|---|---|
| FR1 | Create pipeline from source/target/published mapping | DONE (commit `3866c7e`) | #1 |
| FR2 | Drift validation pre-run | DONE (commit `3866c7e`; hardening bugs #15–#18) | #2 |
| FR3 | Manual run | NOT DONE — spec + design decisions ready | #3 |
| FR4 | Cron schedule + enable/disable | NOT DONE — spec ready | #4 |
| FR5 | Execute E-T-L, report status/progress/row counts | NOT DONE — spec ready | #3 |
| FR6 | Run history (start/end, status, rows, errors) | PARTIAL — models + list endpoint exist; no runs are ever produced yet, single-run read path not exposed | #1, #6 |
| FR7 | Configurable retry on transient failure | NOT DONE — model + spec ready | #5 |
| FR8 | Re-run a past run | NOT DONE — spec ready | #6 |
| FR9 | Audit events (create/edit/run/schedule/enable/disable) | PARTIAL — emitted on CRUD + drift check; run/schedule/enable-disable endpoints don't exist yet | #8 |
| FR10 | Role-gate create/run/disable | PARTIAL — CRUD endpoints gated; run/disable endpoints don't exist yet; zero API-level gating tests | #8, #10 |

**2 of 10 FRs done (FR1, FR2). Everything else is spec-ready, not built.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

> **Rule (added by Bug #13):** a task whose *spec/design decisions* are written but whose code
> has not landed is `[~]` at most. `[x]` means landed, tested code — nothing else.

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_pipeline_data_model.md) | FR1, FR6, §11 | [x] | Pipeline data model + persistence (commit `3866c7e`) |
| [02](02_drift_validation.md) | FR2, AC2 | [x] | Drift validation pre-run (commit `3866c7e`; hardening in bugs #15–#18) |
| [03](03_execution_engine.md) | FR3, FR5, AC1 | [~] | Execution engine (E-T-L) — **spec + design decisions written, no code** |
| [04](04_scheduler.md) | FR4, AC3 | [~] | Scheduler (cron) — spec written, no code |
| [05](05_retry_failure_handling.md) | FR7, AC4 | [~] | Retry + failure handling — spec written, no code |
| [06](06_run_history_rerun.md) | FR6, FR8 | [~] | Run history + re-run — spec written; only list-runs endpoint exists, no runs producible yet |
| [07](07_pipeline_ui_monitoring.md) | FR1, FR3, FR4, FR6 | [ ] | Pipeline UI + monitoring |
| [08](08_audit_role_gating.md) | FR9, FR10 | [~] | Audit emission + role gating — done for CRUD surface; run/schedule endpoints pending |
| [09](09_concurrency_and_queueing.md) | Scalability NFR, Risk table | [~] | Concurrency control / run queueing — spec written, no code; **gap, not in original TRD subtask table** |
| [10](10_tests.md) | §12 DoD | [ ] | Test suite (now explicitly includes API-level role-gating tests, per Bug #19 item 6) |
| [11](11_secret_vaulting_signoff.md) | Security NFR, §9 | [!] | Credential vaulting sign-off — cross-reference, owned by Connectors, not a new task |

## Bugs (2026-07-06 code review of commit `3866c7e`)

| # | Severity | Status | Title |
|---|---|---|---|
| [12](12_bug_legacy_executor_regression.md) | CRITICAL | [x] | Legacy `POST /execute` executor destroyed by Task #1 refactor |
| [13](13_bug_index_status_inflation.md) | HIGH | [x] | INDEX.md status inflation (specs marked as shipped FRs) |
| [14](14_bug_mapping_connection_validation.md) | HIGH | [x] | `create_pipeline` accepts mappings from different connections |
| [15](15_bug_drift_hash_order_dependence.md) | MEDIUM | [x] | Drift hashes column-order-dependent, contradicts `has_drift` |
| [16](16_bug_schemas_equal_duplicates.md) | MEDIUM | [x] | `_schemas_equal` mishandles duplicates / asymmetric |
| [17](17_bug_empty_snapshot_silent_pass.md) | MEDIUM | [x] | Empty baseline snapshot silently disables drift detection |
| [18](18_bug_changed_tables_misses_columns.md) | MEDIUM | [x] | `changed_tables` misses column-level drift |
| [19](19_bug_cleanup_batch.md) | LOW | [x] | Cleanup batch (dead `get_run`, unused imports, `Boolean`, `uselist`; gating-test gap moved into #10's scope) |

## Confidence per task (auto-mode implementation)

- **#1 Data model** — HIGH confidence. Straightforward FastAPI/SQLAlchemy, mirrors the Schema
  Mapper pattern that already works. Foundation everything else depends on — land first.
- **#2 Drift validation** — MEDIUM-HIGH. Mechanical hash comparison once #1 exists; one open
  scoping question (hash the whole source schema vs. only mapping-referenced columns) flagged in
  the task file.
- **#3 Execution engine** — **[~] design decisions documented, no code.** Three open questions resolved:
  batch size (1,000-row batches), idempotency (upsert on natural key, full-table replace fallback),
  and sync-vs-async (Celery from day one). See task file for full rationale.
- **#4 Scheduler** — MEDIUM. Mechanical once #1 and #3's sync/async decision are settled; cron
  edge cases (timezones, step values) are the main risk.
- **#5 Retry** — MEDIUM-HIGH. No retry precedent exists anywhere in this codebase yet, so this
  is the first implementation, not a pattern-match — keep the retryable-error classification
  conservative.
- **#6 Run history + re-run** — HIGH once #1 and #3 exist. Mostly CRUD/read-path work; one
  design point to confirm (re-run replays against the *pinned* mapping version, not the current
  one).
- **#7 Pipeline UI** — MEDIUM. Largest single rewrite in this directory (replaces the whole
  page's interaction model). Recommend a quick UX check on the create-form/schedule-editor
  layout before or during implementation, same caution as Schema Mapper's N:1 UX needed.
- **#8 Audit + role gating** — HIGH. Wires already-implemented, already-tested utilities
  (`require_role`, `record_audit`) onto new endpoints as #1/#4/#6 land. Risk is forgetting to
  gate a newly-added endpoint, not the mechanism itself.
- **#9 Concurrency/queueing** — MEDIUM. Easy to under-scope as "add a semaphore"; the real
  requirement (no two overlapping runs of the *same* pipeline) carries the same data-corruption
  class of risk as #3 and should land alongside it, not as an afterthought.
- **#10 Tests** — Not a standalone auto-mode task; each task above should ship its own tests as
  part of its definition of done (see task file). This entry tracks the rollup.
- **#11 Secret vaulting** — **[!] blocked**, cross-module dependency (owned by Connectors /
  platform-infra, per TRD §2 Out-of-Scope). Not implementable from within this directory; needs
  sign-off from whoever owns Connectors' credential storage.

## Execution order (recommended)

1. **#1 Data model** — everything depends on this.
2. **#2 Drift validation** — small, mechanical, unblocks #3's precondition.
3. **#3 Execution engine** — stop here for design review before writing code (open questions in
   the task file: batch vs. bulk, idempotency key strategy, sync vs. async).
4. **#9 Concurrency/queueing** — land alongside #3/#4, not after, since it protects the same
   invariant #3 is designed to protect.
5. **#4 Scheduler** — needs #3's sync/async decision resolved first.
6. **#5 Retry** — wraps #3/#4's execution task.
7. **#6 Run history + re-run** — needs #1 and #3.
8. **#7 Pipeline UI** — needs #1, #4, #6, #8 (role awareness) to have real APIs to call against.
9. **#8 Audit + role gating** — incremental, applied as each mutating endpoint in #1/#4/#6 lands,
   not saved for the end.
10. **#11 Secret vaulting sign-off** — cross-team, pursue in parallel; don't block other tasks on
    it but don't mark the TRD's Security NFR satisfied without it either.

## Out of scope (confirmed, per TRD §2)

- Mapping definition authoring (owned by Schema Mapper).
- Autonomous decisioning (owned by AI Autopilot).
- Connection management (owned by Connectors) — see task #11 for the one piece of this
  (credential vaulting) that Pipelines has a Security NFR dependency on.
- Visualization of results (owned by Visualize).
- Cross-tenant isolation — same architectural gap flagged app-wide in
  `mapper_tasks/07_tenant_isolation_signoff.md` / `review_schema_mapper_tasks/CONTRADICTIONS.md`
  §C4; not re-litigated here, applies equally to Pipelines' `Pipeline`/`PipelineRun` tables once
  they exist.

## Progress log

- 2026-07-06 — Original phased delivery plan (Phase 1/2/3) written, no code shipped against it.
- 2026-07-06 — Re-audited against actual code (0/10 FRs done); replaced the phase-plan-only
  INDEX with numbered per-task files (01–11) following the `mapper_tasks/` convention; added
  tasks #9 (concurrency/queueing) and #11 (secret vaulting sign-off) as gaps found during the
  audit that weren't in the original PIPE-T1–T9 breakdown.
- 2026-07-06 — Specs with design decisions written for #3, #4, #5, #6, #8, #9. ~~8/10 FRs now
  done~~ *(retracted — see next entry; spec-written ≠ done)*.
- 2026-07-06 — Tasks #1 + #2 implemented and landed (commit `3866c7e`): 5 models, Pydantic
  schemas, `PipelineCRUD` service, 7 endpoints, 25 tests. FR1 + FR2 done.
- 2026-07-06 — Code review of `3866c7e` filed bugs #12–#19 (1 critical, 2 high, 4 medium,
  1 low batch). Corrected this INDEX's inflated statuses (Bug #13): FR table now reflects
  landed code only (2/10 done); tasks #3–#6, #8, #9 reverted `[x]` → `[~]`; status-legend
  rule added. Critical finding: Task #1's refactor broke the legacy `POST /execute` executor
  despite spec + commit message claiming it was untouched (Bug #12).
- 2026-07-06 — Bugs #12–#19 all fixed (16 new tests, suite 164/164 green):
  - #12: legacy executor restored verbatim from `HEAD~1` (all 9 helper methods); new
    `test_legacy_executor.py` pins the dict-envelope contract until Task #3 retires it.
  - #13: this INDEX corrected (see previous entry).
  - #14: `create_pipeline` now 422s when the mapping's `source_id`/`target_id` don't match the
    pipeline's connections, or are NULL (original connections deleted).
  - #15/#16: `_normalize_schema` sorts column lists before hashing; `_schemas_equal` deleted —
    drift is now literally `baseline_hash != current_hash`, so the two signals can't disagree
    and duplicate columns register as multiset drift.
  - #17: missing/empty source snapshot → 422 (fail closed) instead of silent "no drift".
  - #18: `_diff_tables` also names tables whose normalized columns differ, so type changes /
    added columns produce actionable `changed_tables`, not just `has_drift=true`.
  - #19: dead `get_run` removed; `enabled` → `Boolean`; `Pipeline.schedule` now 1:1
    `uselist=False`; unused router imports dropped (service imports turned out to be used by
    the restored legacy executor); GET-/drift-side-effects decision recorded in the bug file;
    API-level role-gating tests added to Task #10's scope.
  Caveat: role gating on pipeline endpoints is still only asserted by code inspection — API-level
  tests remain Task #10 work.