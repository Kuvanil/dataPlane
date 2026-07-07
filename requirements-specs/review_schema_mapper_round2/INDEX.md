# Schema Mapper — Review Round 2 Bug Index

> Source: post-merge review of the mapper_tasks epic diff (`b616b51..HEAD`, i.e. tasks #1/#3/#5/#6
> plus the round-1 architect-review fixes that landed inside commit `0187e76`), conducted
> 2026-07-06. Distinct from `review_schema_mapper_tasks/` (round-1 code-quality review) and
> `mapper_tasks/` (TRD completeness): this round found bugs **in the fixes themselves** plus
> UX gaps in the new N:1 staging flow. Two findings (#1, #2) are regressions introduced by
> round-1 fixes.
>
> Scope: `frontend/src/app/dashboard/schema-mapper/*`, `frontend/src/lib/api.ts`,
> `backend/app/services/mapping_service.py`, `backend/app/services/transformation_grammar.py`.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Severity | Area | Status | Title |
|---|---|---|---|---|
| 1 | HIGH | correctness | [x] | Autosave drain race: stale-closure `saving` guard lets concurrent flushes double-run and silently drop queued ops |
| 2 | HIGH | correctness | [x] | Staged source selection leaks across mapping switches (cross-mapping edge create / stuck phantom pill) |
| 3 | MEDIUM | consistency | [x] | `accept_suggestion` bypasses `_check_target_not_mapped` — AI accept can double-map a target |
| 4 | MEDIUM | correctness | [x] | Single-source concat "too few source parts" unguarded (`sources_count <= 1` early return) |
| 5 | MEDIUM | UX/correctness | [x] | 401 forced redirect trips the beforeunload "Leave site?" dialog (task #5's two mechanisms fight) |
| 6 | MEDIUM | UX | [x] | Concat source order is click order but invisible — replace ✓ with numbered badges |
| 7 | MEDIUM | UX | [x] | Already-mapped columns stageable/clickable → guaranteed server-error toasts; 409 message leaks internal edge id |
| 8 | MEDIUM | UX | [x] | Staging has no clear-all (no pill ×, no Escape); casual clicks silently stage |
| 9 | LOW | UI | [x] | `truncate` broken by `flex` on the rename `<h2>` (no ellipsis); ✎ button nested inside heading |
| 10 | LOW | a11y | [x] | Nullability `*`: bare-span `aria-label` not announced; no legend for 🔑 / `*` / staging badges |
| 11 | LOW | robustness | [x] | `_check_target_not_mapped` TOCTOU — no DB constraint backs the check |
| 12 | LOW | robustness | [x] | `handle401` calls `onUnauthorized` unprotected — a throwing handler skips token clear + redirect |

## Finding details

### #1 Autosave drain race (HIGH) — `useMapping.ts`
`flushDirty` (deps `[saving, showToast]`) drains the queue one op at a time, shifting only after
success. But the interval + `visibilitychange` handlers live in a mount-once effect that captures
the **first render's** `flushDirty`, whose closed-over `saving` is permanently `false` — the
`if (saving) return` guard never blocks those call sites. Overlap scenario: slow PUT in flight
from the 30s interval; user tabs away; `visibilitychange` starts a second drain; both
`await dirtyQueueRef.current[0]()` (op runs twice), both `shift()` — the second shift removes the
*next* op without executing it. Silent data loss — the class task #5 exists to prevent. The old
`splice(0)` was overlap-safe; the round-1 fix reintroduced the race. Fix: ref-based in-flight
guard (`flushingRef`), keep `saving` state for UI only.

### #2 Staged selection leaks across mapping switch (HIGH) — `Canvas.tsx`
`selectedSourceIds` is never reset when `mappingId` changes (load effect doesn't touch it; Canvas
isn't keyed by mapping id). Column ids are `src_${table}_${column}`, so similar schemas collide
across mappings: stage 2 sources in mapping A, switch to B, click a target → concat edge created
in B from A's selection. Non-colliding names instead leave a stuck phantom "N staged" pill with
no visible checkmarks and no way to clear. Fix: reset staging in the `[mappingId]` effect.

### #3 `accept_suggestion` bypasses target guard (MEDIUM) — `mapping_service.py`
`_check_target_not_mapped` is called from `add_edge` only. Its own justification (two edges to one
target is ambiguous at pipeline execution) doesn't care who chose the target: map A→X by hand,
accept AI suggestion B→X → exactly the double-mapped state `add_edge` 409s on. Fix: call the
guard from `_add_edge_internal` too; add test.

### #4 Single-source concat under-consumption (MEDIUM) — `mapping_service.py`
`_check_multi_source_kind` early-returns at `sources_count <= 1`, and `_sql_concat` only raises on
too *many* source parts. Single-source concat is explicitly allowed, so concat with zero `source`
parts on a 1-source edge compiles SQL that silently drops the bound source column — the defect
class the round-1 fix claimed to close, still open for N=1. Fix: hoist the exact-parts-count
check above the early return; add tests.

### #5 401 redirect vs beforeunload (MEDIUM) — `useMapping.ts`
On session expiry with pending edits, `onUnauthorized` writes the localStorage flag, then
`handle401` hard-navigates → `beforeunload` fires with a non-empty queue (by definition) → native
"Leave site?" dialog interrupts the forced logout; "Stay" leaves a dead session that 401s and
re-prompts on the next call. Fix: 401 handler sets a ref that suppresses the beforeunload prompt
(staying cannot save the work anyway — the token is gone).

### #6 Concat order invisible (MEDIUM UX) — `Canvas.tsx`
Generated concat order = click order, but staged columns all render an identical ✓. User merging
`first_name`+`last_name` can't see whether they get "John Doe" or "Doe John" until after the edge
exists. Fix: numbered badges (1, 2, 3…) reflecting staging order; re-click to unstage/restage
reorders intuitively.

### #7 Mapped columns stageable/clickable (MEDIUM UX) — `Canvas.tsx` + `mapping_service.py`
Staging an already-mapped source always ends in the backend many-to-many 422; clicking a mapped
target with staged sources always ends in the new 409 — whose message names an internal edge id
("already mapped by edge 47") users never see. Fix: UI skips staging mapped sources and skips
target-click on mapped targets (visually dimmed while staging); backend 409 message reworded to
name the column, not the edge id.

### #8 Staging has no exit / hair trigger (MEDIUM UX) — `Canvas.tsx`
No clear-all: not the pill, not Escape — each staged column must be re-clicked. Any casual click
stages; one stray click + one target click silently creates a 1:1 edge. Fix: × affordance on the
"N selected" pill + Escape clears staging. (Click-click 1:1 creation kept — legitimate pointer
alternative to drag — but with #7's dimming and the pill + numbered badges it's now deliberate.)

### #9 Rename heading truncate + nesting (LOW) — `WorkspaceHeader.tsx`
Round-1 added `flex` to the `truncate` `<h2>`; `text-overflow: ellipsis` doesn't apply to flex
containers, so long names hard-clip with no ellipsis. The ✎ button is also nested inside the
`<h2>`, so screen readers read it as part of the heading. Fix: `truncate min-w-0` on the h2 text
itself, button as a sibling.

### #10 Nullability a11y + legend (LOW) — `Canvas.tsx`
`aria-label` on a bare `<span>` isn't announced (needs `role="img"` or sr-only text); no legend
explains 🔑 / `*` / staging badges. Fix: proper a11y semantics + one-line legend under the panels.

### #11 Target-guard TOCTOU (LOW) — `mapping_service.py` / model
No unique constraint on `(mapping_id, target_table, target_column)` for draft edges backs
`_check_target_not_mapped`; two concurrent adds can still double-map. Fix or explicitly accept
with a comment (depends on migration tooling available).

### #12 Unprotected 401 handler call (LOW) — `api.ts`
If a registered `onUnauthorized` throws, `handle401` skips `localStorage.removeItem` and the
redirect entirely — the app wedges on an expired token. Fix: try/catch around the handler call.

## Execution order

1. **#1, #2** — silent-data-loss / wrong-data paths. Fix first, one commit each.
2. **#3, #4** — backend guard consistency (shared code path, one commit).
3. **#5** — small, interacts with #1's file.
4. **#6, #7, #8** — one staging-UX pass (same component/flow).
5. **#9, #10** — small UI/a11y cleanups.
6. **#11, #12** — robustness tail; #11 may resolve to "documented accepted risk".

## Confidence per task

All HIGH confidence except #11 (depends on whether migration tooling exists — if none, the honest
fix is a documented accepted risk, not a schema change applied only to fresh databases).

## Progress log

- 2026-07-06 — review round 2 conducted, 12 findings filed, INDEX created. Fixing starts top-down.
- 2026-07-06 — **All 12 fixed.** By finding:
  - **#1** `useMapping.ts`: added `flushingRef` in-flight guard (a ref survives the stale closures
    held by the mount-once interval/visibilitychange handlers); `saving` state kept for UI only,
    dropped from `flushDirty` deps.
  - **#2** `Canvas.tsx`: `setSelectedSourceIds([])` at the top of the `[mappingId]` load effect.
  - **#3** `mapping_service.py`: `_check_target_not_mapped` now also called from
    `_add_edge_internal`; docstring updated. New test
    `test_accept_suggestion_blocks_already_mapped_target` (409, suggestion stays pending).
  - **#4** `mapping_service.py`: concat exact-parts-count check hoisted above the
    `sources_count <= 1` early return in `_check_multi_source_kind`. 2 new tests
    (add_edge + update_edge_transformation with a 0-source-part concat on a 1-source edge).
  - **#5** `useMapping.ts`: `sessionExpiredRef` set by the 401 handler; `onBeforeUnload` stands
    down when it's set, so the forced redirect isn't interrupted by the native dialog.
  - **#6** `Canvas.tsx`: `selectedIds: Set` → `selectedOrder: Map<id, 1-based position>`; staged
    rows render a numbered violet badge (position = concat order) instead of ✓.
  - **#7** `Canvas.tsx`: mapped sources aren't stageable, mapped targets aren't clickable while
    staging (dimmed `opacity-40 cursor-not-allowed` + explanatory `title`); backend 409 reworded
    to name the column instead of the internal edge id.
  - **#8** `Canvas.tsx`: × button on the "N selected" pill + window-level Escape listener both
    clear the whole staging set.
  - **#9** `WorkspaceHeader.tsx`: `truncate min-w-0` restored on a block `<h2>`; ✎ button moved
    out to a sibling so it's no longer heading content.
  - **#10** `Canvas.tsx`: `role="img"` on the 🔑 and `*` glyph spans so aria-labels are announced;
    legend line under the panels (🔑 / `*` / staging instructions incl. Esc).
  - **#11** `models/mapping.py`: partial unique index `uq_field_target_per_draft` on
    `(mapping_id, target_table, target_column) WHERE version_id IS NULL` — the existing
    `uq_field_target_per_version` never covered drafts (NULL `version_id`s are distinct). Honest
    caveat: no migration tooling in this repo, so `create_all` only creates it on fresh
    databases; existing deployments need the equivalent manual `CREATE UNIQUE INDEX`. The
    service-level 409 remains the user-facing path; the index is the concurrency backstop.
  - **#12** `api.ts`: `onUnauthorized?.()` wrapped in try/catch (console.error) so a throwing
    handler can't abort the token clear + redirect.
  - Verification: backend `pytest` **167/167** passing (110/110 in `tests/mapping/`, 3 new);
    `tsc --noEmit` clean; `next build` clean; `next lint` **30 problems — byte-identical count to
    the HEAD baseline** (verified via a throwaway worktree at HEAD), zero new issues. The
    pre-existing `WorkspaceHeader.tsx:43` setState-in-effect lint error predates this round and
    was left untouched.
