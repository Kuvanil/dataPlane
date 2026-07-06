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

## FR1–FR10 verdict (as of 2026-07-06 audit)

| FR | Requirement | Verdict | Task(s) |
|----|---|---|---|
| FR1 | Create pipeline from source/target/published mapping | NOT DONE | #1, #7 |
| FR2 | Drift validation pre-run | NOT DONE | #2 |
| FR3 | Manual run | PARTIAL (legacy ad-hoc executor only, no `Pipeline` entity) | #3, #7 |
| FR4 | Cron schedule + enable/disable | NOT DONE | #4, #7 |
| FR5 | Execute E-T-L, report status/progress/row counts | PARTIAL (SQLite-only path, no persistence) | #3 |
| FR6 | Run history (start/end, status, rows, errors) | NOT DONE | #1, #6 |
| FR7 | Configurable retry on transient failure | NOT DONE | #5 |
| FR8 | Re-run a past run | NOT DONE | #6 |
| FR9 | Audit events (create/edit/run/schedule/enable/disable) | PARTIAL (run only) | #8 |
| FR10 | Role-gate create/run/disable | NOT DONE | #8 |

**0 of 10 FRs fully done, 3 partial (legacy behavior, not TRD-conformant), 7 not started.**

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Task list

| # | TRD ref | Status | Title |
|---|---|---|---|
| [01](01_pipeline_data_model.md) | FR1, FR6, §11 | [ ] | Pipeline data model + persistence |
| [02](02_drift_validation.md) | FR2, AC2 | [ ] | Drift validation pre-run |
| [03](03_execution_engine.md) | FR3, FR5, AC1 | [!] | Execution engine (E-T-L) consuming published mappings — **needs design review** |
| [04](04_scheduler.md) | FR4, AC3 | [ ] | Scheduler (cron) |
| [05](05_retry_failure_handling.md) | FR7, AC4 | [ ] | Retry + failure handling |
| [06](06_run_history_rerun.md) | FR6, FR8 | [ ] | Run history + re-run |
| [07](07_pipeline_ui_monitoring.md) | FR1, FR3, FR4, FR6 | [ ] | Pipeline UI + monitoring |
| [08](08_audit_role_gating.md) | FR9, FR10 | [ ] | Audit emission + role gating |
| [09](09_concurrency_and_queueing.md) | Scalability NFR, Risk table | [ ] | Concurrency control / run queueing — **gap, not in original TRD subtask table** |
| [10](10_tests.md) | §12 DoD | [ ] | Test suite |
| [11](11_secret_vaulting_signoff.md) | Security NFR, §9 | [!] | Credential vaulting sign-off — cross-reference, owned by Connectors, not a new task |

## Confidence per task (auto-mode implementation)

- **#1 Data model** — HIGH confidence. Straightforward FastAPI/SQLAlchemy, mirrors the Schema
  Mapper pattern that already works. Foundation everything else depends on — land first.
- **#2 Drift validation** — MEDIUM-HIGH. Mechanical hash comparison once #1 exists; one open
  scoping question (hash the whole source schema vs. only mapping-referenced columns) flagged in
  the task file.
- **#3 Execution engine** — **[!] blocked on design review**, same as the original plan flagged.
  Transactional semantics, idempotency strategy, and sync-vs-async execution are judgment calls
  with real data-corruption risk if gotten wrong (see task file's risk section). Do not
  auto-implement without a human decision on the three open questions listed there.
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
