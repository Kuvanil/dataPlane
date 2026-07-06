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

- 2026-07-06 — **Post-completion architect review of #1/#3/#5/#6.** Full diff (`b616b51..0845bdd`) reviewed via 8 independent finder angles (correctness × 3, reuse, simplification, efficiency, altitude, conventions) + a verify pass on every candidate. 10 findings confirmed/plausible, all fixed:
  - **Nullability silently dropped on edge create** — `Canvas.tsx`'s `onDrop`/`connectStagedSources` never forwarded `nullable` to `onCreateEdge`, so `mapping_validation_service`'s null-safety check (NOT-NULL target + nullable source) never fired for any Canvas-created edge — the exact data #3 just started displaying wasn't reaching validation. Fixed: both call sites now pass `nullable` through.
  - **Autosave silently dropped queued edits on partial failure** — `flushDirty` spliced the whole queue out before executing any op; a mid-batch failure discarded unexecuted ops with no retry, so `dirtyQueueRef.current.length` read 0 even with unsaved work, defeating the #5 beforeunload/401 warnings in exactly the case they exist for. Fixed: ops are now shifted off one at a time, only after they succeed, so a failure leaves the queue truthfully non-empty and retries next flush.
  - **#5's own warning mechanism didn't survive its own redirect** — `handle401`'s toast could lose the race against the immediately-following hard navigation, and the `dp_session_expired_with_pending` localStorage flag it also wrote was never read anywhere (confirmed via grep — not even by `login/page.tsx`). Fixed: `login/page.tsx` now reads and clears that flag on mount and renders a banner — a signal that survives the redirect regardless of toast timing. Reworded the misleading "best-effort flush" comment in `useMapping.ts` (no flush was ever attempted, correctly — the token's already expired).
  - **Two uncoordinated edge-creation paths could double-map a target** — drag-and-drop and staged multi-select didn't clear each other's state or check `isMapped`, and the backend only guarded source-side reuse, never target-side. Fixed: `onDrop` now clears any staged selection, and `mapping_service.add_edge` gained `_check_target_not_mapped` (409 on a second edge to an already-mapped target — N:1 is one edge with many sources, not two edges).
  - **Auto-generated concat had no separator and no review step** — merging 2+ staged sources produced e.g. `"JohnDoe"` with zero indication, and the transform editor was only reachable by separately selecting the edge afterward. Fixed: the default now inserts a literal `" "` between sources, and `connectStagedSources` auto-selects the new edge (`onSelectEdge`) so `EdgeInspector`/`TransformEditor` is immediately visible.
  - **Concat parts-count under-consumption unvalidated** — `_sql_concat` only rejected too MANY `source` parts, never too FEW, so an edited transformation could silently drop a bound source column (same defect class #1 closed, via a different path: edit-after-create). Fixed: new shared `MappingService._check_multi_source_kind` (also killing the 3x-duplicated guard — reuse finding) now requires an exact parts-count match for `concat`. 3 new backend tests; 107/107 passing.
  - **`rename`/`removeEdge` rollback used a stale closure** — on PUT/DELETE failure, rollback overwrote the whole `mapping` object from the closure captured at call time, silently discarding any concurrent edge change. Fixed: both now use functional `setMapping(prev => ...)` updates.
  - **Sidebar didn't reflect a rename** — `MappingList` fetches its own copy once on mount with no subscription to the header's rename. Fixed: `page.tsx` passes the open mapping's id/name down; `MappingList` patches its cached row in place (no re-fetch).
  - **`window.getSelection()` was the wrong drag-detection signal** — meant to suppress a click right after a drag, but native HTML5 drag-and-drop never touches text selection, so it neither caught real post-drag clicks nor scoped correctly (any unrelated selected text elsewhere on the page could block a click). Fixed: a `justDraggedRef` tied to the actual `dragstart`/`dragend` lifecycle.
  - **Minor efficiency/reuse cleanup** — staged-source lookups now use an id→ColumnNode `Map` and a `Set` for `selectedIds` instead of repeated `Array.find`/`Array.includes` (negligible at the ~1,000-column scale target per confidence note, done for consistency with the `sourceMappedKeys`/`targetEdgeByColumn` pattern already in the file).
  - Not fixed / explicitly deferred: the `onUnauthorized` single-handler-slot design (module-level singleton that a second concurrent mount would clobber) is a latent footgun, not a live bug — schema-mapper is the only consumer today. Flagged here rather than fixed, since the real fix (a central session/idle-warning service) is a product decision, not a bugfix, matching how #2/#4/#7 above are handled.
  - Verification: `pytest tests/mapping/` 107/107 passing, `tsc --noEmit` clean, `next build` clean, `next lint` introduces zero new issues (pre-existing baseline unchanged).
