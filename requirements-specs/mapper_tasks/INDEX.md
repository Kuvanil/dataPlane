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
| 1 | HIGH | FR2/FR3/AC1 | [x] | Many-to-one (N:1) mapping creation is unreachable in the Canvas UI |
| 2 | HIGH | Usability NFR / WCAG 2.1 AA | [?] | Drag-and-drop edge creation has no keyboard alternative |
| 3 | MEDIUM | FR1 | [x] | Nullability is not displayed in the schema panels |
| 4 | MEDIUM | Performance NFR / TRD §10 risk table | [?] | Canvas has no virtualization/search for large schemas |
| 5 | MEDIUM | Reliability NFR | [x] | Unsaved transformation edits can be silently lost on session timeout |
| 6 | LOW | FR8 (implied) | [x] | No UI to rename a mapping (`PUT /mappings/{id}` has no caller) |
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
- 2026-07-06 — **Task #6 done.** Added `rename` action to `useMapping.ts` (snapshot + optimistic-update-with-rollback pattern, matching `removeEdge`). Rewrote `WorkspaceHeader.tsx` to be stateful with inline-edit mode: ✎ pencil icon next to the name swaps the `<h2>` for a text input on click; Enter/blur commits via `onRename`, Escape reverts, empty/unchanged name is a no-op. Edit affordance hidden when `!canEdit` (published mappings or viewer role). Wired `onRename={(name) => m.rename(name)}` into `page.tsx`. Frontend builds clean. No backend changes — the rename endpoint, audit, and role gating already existed and were tested.
- 2026-07-06 — **Task #5 done.** Added pluggable `setUnauthorizedHandler(fn)` to `lib/api.ts`; `handle401()` now calls `onUnauthorized?.()` before clearing the token, so feature code can warn/flush first. `useMapping.ts` registers a handler in its mount effect that persists `dp_session_expired_with_pending=<count>` to localStorage and shows an error toast naming the number of unsaved edits; also adds a `beforeunload` listener that asks the browser to confirm navigation when the dirty queue is non-empty. Handler is torn down on unmount. Non-schema-mapper pages that don't register a handler see the original silent-redirect behavior unchanged. Honest caveat: the literal NFR ("no data loss on session timeout") cannot be fully guaranteed without a refresh-token flow that doesn't exist in this codebase; this delivers "no *silent* data loss" — the user is told what happened instead of being silently redirected. Frontend builds clean. Task mapper_tasks/05_session_timeout_autosave_loss.md done.
- 2026-07-06 — **Task #1 done.** Two-part fix:
  1. Backend guard — added `MULTI_SOURCE_KINDS = frozenset({"concat"})` to `transformation_grammar.py`; in `mapping_service.py` added a `len(sources) > 1 and kind not in MULTI_SOURCE_KINDS` guard in `add_edge`, `update_edge_transformation`, and `_add_edge_internal`. Returns 422 with `kind: grammar_error` explaining which kinds support N sources. 4 new tests (`test_add_edge_blocks_multi_source_with_direct_kind`, `test_add_edge_allows_multi_source_with_concat_kind`, `test_add_edge_allows_single_source_with_concat_kind`, `test_update_edge_transformation_blocks_multi_source_non_concat`). 104/104 passing.
  2. Frontend multi-select UX in `Canvas.tsx` + `SchemaPanel`: added `selectedSourceIds` state, `toggleSourceSelection`, `connectStagedSources` handlers; clicking a source column toggles it into the staging set (rendered with a violet ✓ + left border); a "N sources staged — click target" pill appears in the target panel header once ≥1 source is staged; clicking a target column then calls `onCreateEdge` with all staged sources and a transformation computed from the count (1 → direct, 2+ → concat). The existing single-source drag-and-drop path is unchanged for the common 1:1 case. `onCreateEdge` signature gained a `transformation` parameter; `page.tsx` no longer hardcodes `{kind: "direct"}`. Frontend builds clean. Task mapper_tasks/01_n_to_one_ui.md done.

  **UX note (MEDIUM confidence area per INDEX.md):** the multi-select flow is purely additive and works end-to-end, but the visual styling of the staging pill, the checkmark affordance on selected columns, and the cursor change (crosshair) are reasonable baselines. A human designer should review for polish — particularly the placement of the staging counter on narrow screens.
