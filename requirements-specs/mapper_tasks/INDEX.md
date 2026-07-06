# Schema Mapper — TRD Completeness Task Index

> Source: TRD-vs-implementation audit conducted 2026-07-06, following the code-quality review in
> `requirements-specs/review_schema_mapper_tasks/` (all 10 findings there are done — see that
> directory's `INDEX.md`). This directory covers a **different question**: not "is the code
> correct?" but "does the shipped feature actually deliver every FR/NFR/AC in
> `requirements-specs/TRD_DataPlane_Schema_Mapper.md`?" It doesn't, fully — these are the gaps.
>
> Scope: `frontend/src/app/dashboard/schema-mapper/*` (primarily), plus the backend grammar/service
> guard in task #1 and the tenant-isolation cross-reference in task #7.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Severity | TRD ref | Status | Title |
|---|---|---|---|---|
| 1 | HIGH | FR2/FR3/AC1 | [~] | Many-to-one (N:1) mapping creation is unreachable in the Canvas UI |
| 2 | HIGH | Usability NFR / WCAG 2.1 AA | [?] | Drag-and-drop edge creation has no keyboard alternative |
| 3 | MEDIUM | FR1 | [x] | Nullability is not displayed in the schema panels |
| 4 | MEDIUM | Performance NFR / TRD §10 risk table | [?] | Canvas has no virtualization/search for large schemas |
| 5 | MEDIUM | Reliability NFR | [~] | Unsaved transformation edits can be silently lost on session timeout |
| 6 | LOW | FR8 (implied) | [~] | No UI to rename a mapping (`PUT /mappings/{id}` has no caller) |
| 7 | HIGH (deferred) | TRD §9 assumption / DoD | [!] | Tenant isolation + Security/Compliance sign-off — cross-reference, not a new task |

## Confidence per task (auto-mode implementation)

- **#1 N:1 UI** — HIGH confidence on the backend guard (small, mechanical). MEDIUM on the
  Canvas UX (multi-select click flow + new affordance pill) — design choices matter here.
  Implementation will land a baseline; UX polish may need a follow-up review.
- **#2 Keyboard a11y** — **[?] open.** WCAG 2.1 AA for drag-and-drop requires a proper
  accessibility audit (focus management, ARIA roles, screen reader announcements). Auto-
  implementing without an audit risks shipping something that looks right but fails real users
  with screen readers or keyboard-only navigation. Needs a human accessibility pass.
- **#3 Nullability display** — HIGH confidence. Pure display addition, data already in the
  connector schema payload. Will land.
- **#4 Canvas virtualization** — **[?] open.** Proper virtualization for 1,000 columns
  needs careful scroll position handling + windowing math. A naive implementation that renders
  everything in a scroll container won't meet the NFR; a real virtualization library
  (react-window, react-virtualized) would be a new dependency. Without product sign-off on the
  library choice, I'd ship a half-fix that either adds the dependency unilaterally or falls
  short of the NFR. Needs a decision.
- **#5 Session timeout autosave loss** — HIGH confidence. Add beforeunload listener,
  visibilitychange flush, and 401-then-redirect warning. Mechanical.
- **#6 Rename UI** — HIGH confidence. Inline-edit name field + PUT call. Mechanical.
- **#7 Tenant isolation** — [!] blocked on product decision (same as
  `review_schema_mapper_tasks/CONTRADICTIONS.md` §C4).

## Execution order (in auto mode)

1. **#3 Nullability display** — smallest, most self-contained. Land first.
2. **#6 Rename UI** — also small. Land next.
3. **#5 Autosave preservation** — moderate scope, frontend-only. Land next.
4. **#1 N:1 mapping UI** — backend guard + frontend UX. Land last among auto-implementable
   tasks. UX polish may need a follow-up review.

#2 and #4 stay open with the confidence notes above. #7 stays blocked.

## Progress log

- 2026-07-06 — started build. INDEX.md updated.
- 2026-07-06 — **Task #3 done.** Added `nullable` to ColumnNode, forwarded it in `flattenSchema`, updated api.get type signature, added `*` suffix indicator for NOT NULL in SchemaPanel row rendering. Frontend builds clean. No data-model or API change — purely additive UI.
- 2026-07-06 — Task #6 next (Rename UI).
