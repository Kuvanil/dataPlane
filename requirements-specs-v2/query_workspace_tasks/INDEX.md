# Unified Query Workspace — Merge AskData Bot + Query Studio into One Tab, with Investigate Handoffs from Schema Intel & Schema Mapper — Task Index

> Source: `requirements-specs/TRD_DataPlane_AskData_Bot.md` + `requirements-specs/TRD_DataPlane_Query_Studio.md`.
> Both TRDs are already **8/9 FRs built and shipped as two separate sidebar tabs** —
> `/dashboard/askdata` (chat, see `requirements-specs/askdata_bot_tasks/INDEX.md`) and
> `/dashboard/query-studio` (SQL editor, see `requirements-specs/query_studio_tasks/INDEX.md`).
> This epic does **not** re-implement either FR set — it consolidates the two already-working
> UIs into a single dashboard tab with a mode toggle, per the request to combine them. No backend
> router changes are anticipated (`askdata.py` and `query_studio.py` stay separate domains); this
> is a frontend-shell and navigation change.
>
> **2026-07-14 scope extension:** the merged tab should also have "knowledge of what's happening"
> in Schema Mapper / Schema Intel — i.e. when either surfaces something that needs a follow-up
> action (schema drift, a newly-flagged PII column, a mapping validation problem, a low-confidence
> AI suggestion), the user should be able to jump straight into Query Workspace (Ask or SQL mode)
> with the relevant connection/table/column already in context, rather than re-navigating and
> re-selecting everything by hand. Tasks #9–#12 below cover this; they're additive on top of the
> merge (#1–#8) and touch `frontend/src/app/dashboard/schema/` and
> `frontend/src/app/dashboard/schema-mapper/` for the first time in this epic. Still no backend
> router changes anticipated — see decision #10 below for why.
>
> **2026-07-14 audit of current cross-feature wiring**, since this is exactly what a merge has to
> not break:
> - Sidebar (`frontend/src/app/dashboard/layout.tsx:18-19`) has two separate menu items —
>   `Query Studio` (💬) and `AskData Bot` (🤖, with a pulsing "online" dot at line 42).
> - The only existing link between them is a **hard full-page navigation**:
>   `ChatBubble.tsx`'s `sendToQueryStudio()` writes `{connectionId, sql}` to
>   `sessionStorage["qs-handoff"]` and does `window.location.href = "/dashboard/query-studio"`
>   (`askdata/components/ChatBubble.tsx:5-8`); Query Studio's `page.tsx` reads and clears that key
>   in a mount-time effect (`query-studio/page.tsx:34-45`). This whole mechanism exists **only**
>   because the two features live on different pages today — merging them into one tab makes it
>   unnecessary, not harder.
> - Both pages independently fetch `GET /api/v1/connectors/` and independently default
>   `connectionId` to the first result (`askdata/page.tsx:29-36`, `query-studio/page.tsx:47-54`) —
>   two separate `useState`s that happen to usually agree.
> - Neither page has a "send to Visualize" handoff implemented yet — both TRDs' FR5/FR7 on that
>   point are `[?]` open product decisions in their respective INDEX files, unrelated to this
>   merge. **Out of scope here — do not attempt it as part of this epic.**
> - Query Studio has a right-hand sidebar (History/Saved tabs, `w-72`, `page.tsx:221-243`) that
>   AskData has no equivalent of. Query Studio also has a write-confirmation modal
>   (`WriteConfirmModal`) that can be open mid-flow.
> - Neither page's Cmd/Ctrl+Enter or Enter key handling is scoped to "am I the visible tab" — no
>   need for that today since only one can ever be on screen, but a merge changes that.
>
> **2026-07-14 audit of Schema Intel / Schema Mapper — what exists to hang the new handoffs off:**
> - **Schema Intel drift** (`frontend/src/app/dashboard/schema/components/DriftHistoryPanel.tsx:32-68`):
>   renders `tables_added`/`tables_removed`/`columns_added`/`columns_removed`/`type_changes` from a
>   `DriftEventSummary` — plain text, no per-row action button today. Backing model:
>   `backend/app/models/drift_event.py:18-51` (`DriftEvent` — `connection_id`, the above JSON
>   fields, `detected_at`).
> - **Schema Intel PII/classification** (`frontend/src/app/dashboard/schema/components/CatalogTableCard.tsx:53-88`):
>   each column shows a classification badge (label/confidence/method) with only an "Override"
>   action (opens `OverrideModal`) — no "investigate" affordance. Backing model:
>   `backend/app/models/schema_catalog.py:116-144` (`ColumnClassification`).
> - **Schema Mapper AI suggestions** (`frontend/src/app/dashboard/schema-mapper/components/SuggestionPanel.tsx:56-103`):
>   each pending `AISuggestion` row already carries `source_table`/`source_column`/`target_table`/
>   `target_column`/`confidence`/`reason` directly (`backend/app/models/mapping.py:142-168`) —
>   no lookup needed to build a handoff from these.
> - **Schema Mapper validation issues** (`frontend/src/app/dashboard/schema-mapper/components/ValidationPanel.tsx:11-85`):
>   each `ValidationIssue` carries `edge_id`/`suggestion_id`/`verdict`/`message` — **not** the
>   resolved source/target table/column — today's only action is "Jump to edge #N →", which
>   selects the edge within the same Canvas (same-page only). A handoff from here needs the
>   table/column resolved from the mapping's own `edges` array (available in `page.tsx`/`Canvas.tsx`
>   state), not from `ValidationIssue` alone.
> - **Cross-feature handoff mechanisms in this codebase today:** exactly one —
>   `sessionStorage["qs-handoff"]` between AskData and Query Studio (being replaced by task #3's
>   in-shell callback, since that pair becomes same-page). A grep across the whole frontend found
>   no other `sessionStorage` keys and no other `router.push`-with-state pattern. Tasks #9-#12
>   below introduce the **second** one — necessarily still `sessionStorage`-based, because Schema
>   Intel and Schema Mapper remain genuinely separate routes from Query Workspace even after this
>   merge (unlike AskData/Query Studio, they are not being combined into the same page).
> - Neither TRD (`TRD_DataPlane_Schema_Intel.md`, `TRD_DataPlane_Schema_Mapper.md`) specifies this
>   integration as an FR — it's a net-new cross-module UX addition, not a gap-closure item.

## Design decisions & edge cases (read before implementing any task below)

This is the "smoother integration" design pass the merge needs to actually be smoother, not just
visually collapsed into one sidebar row:

1. **Keep both subviews mounted; toggle visibility, don't unmount/remount.** The natural
   implementation (`{mode === "ask" ? <AskDataView/> : <SqlView/>}`) would remount the losing
   subview on every switch — discarding chat history, the SQL draft, scroll position, and
   silently aborting any in-flight request. Both subviews must stay mounted permanently under the
   shared shell, switched with a `hidden` class (or equivalent), so state and pending network
   calls survive a mode switch. This is the single decision most of the tasks below depend on.
2. **One connection source of truth, not two.** Lift `connections`/`connectionId` state into the
   shared shell (fetch `/api/v1/connectors/` once), pass down to both subviews as props. Today's
   two-independent-`useState` setup happens to agree because both default to `data[0].id`, but a
   naive merge that kept two separate fetches would make it *possible* to have Ask mode pointed at
   connection A and SQL mode at connection B simultaneously with no visual indication they'd
   diverged — worse than the current two-tab reality, where at least the URL made the separation
   obvious. This must not regress.
3. **In-place handoff, not sessionStorage + hard navigation.** `sendToQueryStudio()`
   (`ChatBubble.tsx:5-8`) becomes a callback prop that sets the shell's `sqlText` +
   `connectionId` and flips `mode` to `"sql"` — no `window.location.href`, no storage round-trip,
   no full-page reload. The mount-time sessionStorage-consuming effect in Query Studio's
   `page.tsx` (lines 34-45) becomes dead code once nothing writes that key anymore and should be
   removed, not left dormant, since it reads from a shared multi-page key (`qs-handoff`) that's
   no longer part of the architecture.
4. **Pending write-confirmation modal blocks a silent mode switch.** If `pendingConfirm` is true
   (SQL mode has an uncommitted write awaiting explicit confirmation) and the user switches to Ask
   mode, don't let the modal quietly vanish behind a hidden subview. Either keep the modal
   rendered at the shell level (above both subviews, so it stays visible/blocking regardless of
   which mode tab is active) or explicitly cancel it with a visible toast ("write confirmation
   cancelled — switched to Ask mode") — pick the former; an in-flight destructive-write decision
   should not become easier to lose track of than it is today.
5. **In-flight requests keep running in the background mode.** An AskData question mid-flight or
   a SQL query mid-execution, followed by a mode switch, must complete normally against the now-
   hidden subview and land its result there — never aborted by the switch (this falls out of
   decision #1 for free) and never silently double-fired to the visible mode's UI region.
6. **Keyboard shortcuts scope to the active + focused mode.** `Enter`-to-send (Ask) and
   Cmd/Ctrl+Enter-to-run (SQL) must only fire from the currently visible, focused subview. Since
   both stay mounted (#1), a naive global keydown listener on either subview would fire even while
   hidden. Gate each subview's key handler on `mode === "ask"` / `mode === "sql"` respectively.
7. **Old routes redirect, they don't 404.** `/dashboard/askdata` and `/dashboard/query-studio` are
   likely bookmarked and may already be referenced from Audit Trail entries or elsewhere in the
   app. Replace each with a minimal redirect to `/dashboard/query-workspace?mode=ask` /
   `?mode=sql` rather than deleting the routes outright.
8. **Audit Trail must still read as two distinguishable event sources.** No backend change is
   expected — `askdata.question_answered` and `query.select_executed`/`query.write_executed`/etc.
   already carry different `module`/`event_type` values — but verify the Audit Trail UI's labeling
   doesn't get confusing once both actions originate from what now looks like one sidebar tab to
   the end user.
9. **Explicitly out of scope, carried over unchanged:** the sessionStorage-based "send to
   Visualize" handoff doesn't exist for either feature yet and stays a `[?]` open product decision
   in the source epics — this merge must not block on it or attempt to design it. Security
   sign-off (`askdata_bot_tasks/09`, `query_studio_tasks/10`) is also unaffected and unblocked by
   this epic; a UI reshuffle doesn't require re-running it, but also must not be treated as
   satisfying it.
10. **A second, deliberately different handoff mechanism for Schema Intel/Mapper → Query
    Workspace.** Don't confuse this with decision #3. Decision #3 removes `sessionStorage` between
    AskData and Query Studio because the merge makes them the same page. Schema Intel and Schema
    Mapper are **not** merging into anything here — they stay separate routes — so a genuine
    cross-page handoff is still needed, just generalized beyond the old narrow `qs-handoff` shape.
    Use a new, explicitly-named key (e.g. `"query-workspace-handoff"`) carrying a structured
    payload:
    ```ts
    type WorkspaceHandoff = {
      connectionId: number;
      mode: "ask" | "sql";
      sql?: string;              // sql mode: pre-filled editor text (scaffold, e.g. `SELECT * FROM <table> LIMIT 100;`)
      prefillQuestion?: string;  // ask mode: pre-filled but NOT auto-sent chat input
      banner: { sourceModule: "schema_intel" | "schema_mapper"; summary: string };
    };
    ```
    Query Workspace's shell reads/clears this once on mount (same read-once-then-remove pattern
    the old `qs-handoff` used), applies `connectionId`/`mode`/`sql`/`prefillQuestion`, and renders
    a dismissible banner using `banner.summary` so the user knows *why* they landed here with
    prefilled state, and which module sent them.
11. **Prefer prompt-text grounding over a new backend parameter for AskData's "focus."** When a
    drift/PII/validation handoff routes to Ask mode, don't add a new `focus_table`/`focus_column`
    param to `POST /askdata/ask` — the existing NL-to-SQL generation already grounds against the
    full catalog (`askdata_bot_tasks/01`), so a `prefillQuestion` that plainly names the table/
    column (e.g. "What does the current data in `customers.email` look like, and does anything
    look off since it changed type?") should already bias generation toward the right entity with
    zero backend change. Treat a dedicated focus param as a fallback only if manual testing in
    task #12 shows the named-entity approach doesn't reliably ground — don't build it preemptively.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked (needs manual decision)
- `[?]` open — not confident enough to auto-implement; needs human input

## Priority order (top → bottom)

| # | Title | Status | Depends on |
|---|---|---|---|
| [01](01_unified_shell_and_mode_toggle.md) | Shared workspace shell + Ask/SQL mode toggle, both subviews kept mounted | [x] | — |
| [02](02_shared_connection_source_of_truth.md) | Single connection fetch/state lifted into the shell | [x] | #1 |
| [03](03_inplace_handoff_no_navigation.md) | Replace sessionStorage handoff with in-shell callback | [x] | #1, #2 |
| [04](04_mode_switch_guardrails.md) | Guardrails: pending write-confirm modal, in-flight requests survive switch | [x] | #1 |
| [05](05_keyboard_shortcut_scoping.md) | Scope Enter/Cmd+Enter handlers to the active mode | [x] | #1 |
| [06](06_navigation_consolidation_and_redirects.md) | Collapse sidebar entries into one tab; redirect old routes | [x] | #1 |
| [07](07_audit_trail_label_clarity.md) | Verify Audit Trail still distinguishes Ask vs SQL events under one tab | [x] | #6 |
| [08](08_tests_and_verification.md) | Consolidate tests, add mode-switch/handoff/redirect coverage, manual verify | [x] | #1–#7 |
| [09](09_generic_investigate_handoff_mechanism.md) | Generic `WorkspaceHandoff` contract + Query Workspace consumes it + context banner | [x] | #1, #2 |
| [10](10_schema_intel_investigate_actions.md) | "Investigate in Query Workspace" actions on drift events + PII/classification badges | [x] | #9 |
| [11](11_schema_mapper_investigate_actions.md) | Same, on AI suggestions + validation issues | [x] | #9 |
| [12](12_tests_and_verification_for_investigate_flows.md) | Tests + manual verification for all four investigate entry points | [x] | #9, #10, #11 |

## Confidence per task (auto-mode implementation)

- **#1 Shell + toggle** — HIGH confidence. Mechanical: new page hosting two existing components
  side by side with visibility toggling, lifting state that's already shaped compatibly (both
  pages already use the same `Connection` shape and the same `api.get<Connection[]>("/api/v1/connectors/")`
  call).
- **#2 Shared connection state** — HIGH confidence. Deleting one of two near-identical fetch
  effects and threading props down.
- **#3 In-place handoff** — HIGH confidence. Replaces a sessionStorage round-trip with a direct
  callback; strictly simpler than what exists.
- **#4 Mode-switch guardrails** — MEDIUM confidence. The write-confirm-modal-at-shell-level
  decision is a judgment call (documented above as decision #4); mechanically straightforward
  once made.
- **#5 Keyboard scoping** — HIGH confidence. Small, self-contained conditionals.
- **#6 Navigation + redirects** — HIGH confidence. `layout.tsx` menu array edit + two thin
  redirect pages.
- **#7 Audit label check** — HIGH confidence, but it's a verification task, not a build task —
  may turn up nothing to change.
- **#8 Tests** — MEDIUM confidence. Relocating existing Vitest suites is mechanical; new
  mode-switch/guardrail tests need care to actually exercise the "stays mounted" behavior rather
  than just asserting the toggle renders.
- **#9 Generic handoff mechanism** — HIGH confidence. Structurally the same pattern as the
  original `qs-handoff` (read-once-on-mount, then clear), just a richer payload shape and a banner
  render — well-precedented in this codebase.
- **#10 Schema Intel actions** — HIGH confidence for the PII/classification badge case (fields
  already resolved in `CatalogTableCard`). MEDIUM for drift events — `DriftEventSummary`'s JSON
  fields name tables/columns as strings, not resolved `ColumnNode`/connection objects, so building
  a correct `connectionId` + table/column payload needs to trace back to the snapshot's
  `connection_id` (available on the parent `SchemaSnapshotSummary`, per the audit above).
- **#11 Schema Mapper actions** — HIGH confidence for `SuggestionPanel` (all fields already on
  `AISuggestion`). MEDIUM-LOW for `ValidationPanel` — `ValidationIssue` doesn't carry resolved
  table/column, only `edge_id`; the action button needs to live where the edges array is in scope
  (likely threaded down from `page.tsx`/`Canvas.tsx`, not added purely inside `ValidationPanel`
  itself) — this is real integration work, not a one-line addition.
- **#12 Tests** — MEDIUM confidence, same reasoning as #8: the mechanical parts (payload shape,
  banner render) are easy to test; asserting the *right* table/column got resolved for a drift
  event or a validation issue needs realistic fixture data, not just a happy-path stub.

## Execution order (in auto mode)

1. **#1 Shell + toggle** — everything else builds on this.
2. **#2 Shared connection state** — small, unblocks #3.
3. **#3 In-place handoff** — depends on #1/#2 existing.
4. **#4 Mode-switch guardrails** and **#5 Keyboard scoping** — independent of each other, both
   depend only on #1; can be done in either order.
5. **#6 Navigation + redirects** — depends on #1 (the new route must exist before old ones can
   redirect to it).
6. **#7 Audit label check** — depends on #6 (needs the merged tab to exist and be reachable).
7. **#8 Tests + verification** — closes out the merge itself, once #1-#7 have landed.
8. **#9 Generic handoff mechanism** — depends only on #1/#2 (the shell and shared connection
   state); can start as soon as those land, doesn't need #3-#8 finished first.
9. **#10 Schema Intel actions** and **#11 Schema Mapper actions** — both depend on #9's contract
   existing; independent of each other, can be done in either order or in parallel.
10. **#12 Tests + verification** — last, once #9-#11 have all landed.

## Progress log

- 2026-07-14 — Epic scoped and INDEX.md created. Both source features confirmed fully built and
  independently working (8/9 FRs each per `askdata_bot_tasks/INDEX.md` and
  `query_studio_tasks/INDEX.md`); this epic is a frontend-only consolidation, no FR re-work. Not
  started.
- 2026-07-14 — Scope extended per follow-up request: added tasks #9-#12 for "Investigate in Query
  Workspace" handoffs from Schema Intel (drift, PII/classification) and Schema Mapper (AI
  suggestions, validation issues). Audited both features' current UI/models (see notes above
  "Design decisions") — confirmed neither has any existing outbound cross-tab link today, and
  neither TRD specifies this integration as an FR (net-new UX addition). Not started.
- 2026-07-14 — **All 12 tasks built** (by a separate session — this entry covers the post-build
  review pass, not the original build). Reviewed every changed file against its task spec; findings
  and fixes recorded in `bugs.md`, follow-up ideas in `enhancements.md`. Summary:
  - **Fixed (5):** (1) `ValidationPanel`'s suggestion-linked "Investigate →" sent a hardcoded
    `SELECT * FROM related_table LIMIT 100;` — a real placeholder-UI violation — now resolves the
    real `source_table`/`source_column` via a `suggestions` prop threaded from `page.tsx`
    (`m.suggestions`), and doesn't render the button at all if the suggestion can't be resolved.
    (2) AskData's background-completion badge (`bgAskComplete`) could never fire — `AskDataView`
    had no `onBackgroundComplete` equivalent to `SqlWorkspaceView`'s; added one, mirroring the SQL
    side's `running`-transition tracking. (3) Removed the dead `sessionStorage["qs-handoff"]` +
    `window.location.href` fallback left in `ChatBubble.tsx` (task #3 said to delete it; it wasn't) —
    `onEditInSql` is now a required prop. (4) The shipped SQL-handoff mechanism
    (`sqlViewRef.current?.setSqlText()` + `setTimeout(...,0)`) wasn't the one task #8's own tests
    exercised (`externalSqlText` prop) — switched `QueryWorkspaceInner` to use the declarative prop
    path, which is simpler and now matches the existing test. (5) `npm run lint` (this repo's
    config includes the newer `react-hooks/refs` / `react-hooks/set-state-in-effect` rules) caught
    two more real issues not found by manual review: the shell-level write-confirm modal read
    `sqlViewRef.current` during render (fixed via a new `onWriteConfirmDetailsChange` reactive
    callback + real state), and the WorkspaceHandoff-consuming effect did 5 setState calls on every
    mount instead of seeding initial state via a lazy `useState` initializer (fixed, no effect
    needed at all now).
  - **Added test coverage (0 → 106 tests passing)** for what task #8/#12 asked for but didn't
    land: `query-workspace/__tests__/QueryWorkspaceInner.test.tsx` (mode toggle preserves state
    across a switch, `?mode=` vs `WorkspaceHandoff` precedence, write-confirm modal survives a mode
    switch, in-shell AskData→SQL handoff), `query-workspace/__tests__/handoff.test.ts`
    (read/write/clear round-trip + malformed-JSON safety), and one test file per investigate
    action (`schema/components/__tests__/DriftHistoryPanel.test.tsx`,
    `CatalogTableCard.test.tsx`, `schema-mapper/components/__tests__/SuggestionPanel.test.tsx`,
    `ValidationPanel.test.tsx` — the last of which specifically asserts the fixed suggestion-issue
    bug doesn't regress, i.e. the emitted SQL never contains `related_table`).
  - **Left open (3, all LOW, tracked in `bugs.md`/`enhancements.md`):** new tests live under the
    old `askdata/__tests__/`/`query-studio/__tests__/` dirs rather than being relocated (churn on
    passing tests, not worth it); `ValidationPanel`'s edge-based action only reads
    `edge.sources[0]` for N:1 edges (needs a product decision on the right multi-source query
    shape); `CatalogTableCard`'s Investigate action only shows for `label === "PII"`, not
    "Sensitive" (scope judgment call).
  - **Verified:** `tsc --noEmit` clean, `npm run lint` clean for every file this epic touches
    (remaining problems are pre-existing, in files this epic never touched), `npm run build` clean
    (19/19 routes, including `/dashboard/query-workspace` and both redirect stubs), `npx vitest run`
    106/106 passing. Not yet exercised against a live backend/browser session (no Docker/browser
    tooling available in this pass) — flagged rather than claimed.
