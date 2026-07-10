# Semantic / Metrics Layer (DP-SEM-001) — Task Index

> Source: `requirements-specs/TRD_new.md` (10 subtasks SEM-T1 through SEM-T10, 9 FRs, ~4-5 weeks estimated)
> Scope: backend `/api/v1/semantic/*` + frontend `/dashboard/semantic` + resolution engine + audit + tests
> Pre-existing: `backend/app/models/schema_catalog.py` (Schema Intel's catalog tables/columns/foreign_keys) — the physical-schema anchor SEM-T2 maps into.

## ⚠️ Complexity + confidence assessment (per user instruction)

The full DP-SEM-001 scope is too large + too design-dependent for a single auto-mode session. Several subtasks have first-class design decisions that need human review before code lands:

| # | Subtask | Status | Why it's open |
|---|---|---|---|
| 1 | Semantic definition model + language | [~] partial | **Design review needed for the no-SQL definition language itself** (aggregation, filters, joins, time-grain — what's the JSON shape?). Data model only is safe. |
| 2 | Physical-schema mapping + lineage | [open] | Needs Schema Intel service to expose a stable catalog query API. |
| 3 | Query resolution engine | [open] | Translating definitions → SQL with policy enforcement is the meatiest piece; data-corruption-class risk. |
| 4 | Versioning + governed publish | [~] partial | Versioning columns + draft/published status are safe. Collaboration integration blocked on Collaboration module. |
| 5 | Metric catalog + search + certified badges | [open] | UI + search backend; larger surface than #1. |
| 6 | Metric editor UI | [open] | UX-critical; needs human review before implementation. |
| 7 | Visualize + AskData Bot integration | [blocked] | Consumers exist but not ready for semantic integration. |
| 8 | Policy enforcement in resolution | [blocked] | Security module's policy API is a cross-team dependency. |
| 9 | Audit emission | [pending → in scope with #1] | Uses existing record_audit; safe. |
| 10 | Tests | [pending] | Each task ships its own tests as part of DoD. |

## Safe auto-implementable scope (this cycle)

1. **#1 (partial)** — Data model only: `Entity`, `Dimension`, `Measure`, `MetricDefinition`, `Lineage` SQLAlchemy models + Pydantic schemas. The definition language itself stays open for design review.
2. **#4 (partial)** — Versioning columns on MetricDefinition (version_number, status=draft|published, published_at, published_by) + draft/published transitions. No Collaboration integration.
3. **#9** — Audit emission on every definition change/publish, using existing `record_audit`.

Everything else stays open per the INDEX.

## Execution plan (auto mode)

Working top → bottom in priority order. Each item:
- Edit source (model / schema / service / router).
- Add or update a focused test that would have caught the bug.
- Run `pytest tests/semantic/ -v` after each item; full suite must stay green.
- Commit with `feat(semantic): …` (or `fix:`).

After the auto-implementable scope lands, stop and surface the open design questions for human review (especially SEM-T1's definition language shape).

## Confidence per item

- **#1 data model** — HIGH. Pure SQLAlchemy + Pydantic schema, mirrors the Pattern Mapper / Pipelines upgrades.
- **#4 versioning columns** — HIGH. Mechanical; versioning pattern is well-established.
- **#9 audit** — HIGH. `record_audit` is already used everywhere; the new audit calls follow the same pattern.

## Confidence per item (DEFERRED)

- **#1 (language design)** — OPEN. The JSON shape of the definition (`{ aggregation, filters, joins, time_grain }`) is a first-class design decision.
- **#2 mapping + lineage** — OPEN. Depends on Schema Intel service surface.
- **#3 resolution engine** — OPEN. Complex; data-corruption risk.
- **#5 catalog + search** — OPEN. UI + backend; needs design review.
- **#6 metric editor** — OPEN. UX-critical.
- **#7 consumer integration** — BLOCKED. Visualize + AskData Bot not ready.
- **#8 policy enforcement** — BLOCKED. Security module dependency.

## Out of scope (confirmed, per TRD §2)

- Physical schema discovery (owned by Schema Intel).
- Chart rendering (owned by Visualize).
- NL generation (owned by AskData Bot).
- Arbitrary SQL authoring (owned by Query Studio).
