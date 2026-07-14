# Query Workspace epic — post-build bug review

> Review date: 2026-07-14. Scope: the uncommitted working-tree implementation of all 12 tasks in
> `INDEX.md` (`frontend/src/app/dashboard/query-workspace/**`, plus the modified `askdata/`,
> `query-studio/`, `schema/`, `schema-mapper/`, and `layout.tsx` files). Read every changed file
> against its task spec rather than trusting the "built" claim; findings below are what didn't
> match. Status legend matches the epic's: `[ ]` open, `[x]` fixed in this pass.

## Findings

### 1. `[x]` HIGH — Hardcoded placeholder SQL in a Schema Mapper "Investigate →" action

**File:** `frontend/src/app/dashboard/schema-mapper/components/ValidationPanel.tsx:111-129` (the
`!iss.edge_id && iss.suggestion_id` branch).

The button writes:
```ts
sql: `SELECT * FROM related_table LIMIT 100;`
```
`related_table` is a literal string, not resolved from `iss.suggestion_id` at all. Every click on
this action sends the user to SQL mode with a query against a table that doesn't exist — it will
always fail. This is exactly the "no placeholder/mock UI" case `CLAUDE.md`'s non-negotiables call
out: a button wired to fake output instead of a real endpoint/value. Task #11 said to resolve via
the suggestion's already-known `source_table`/`source_column` "no lookup needed" — but
`ValidationPanel` was never given the suggestions data to resolve `suggestion_id` against, so the
implementation fell back to a stub instead of leaving the action unbuilt or threading the data
through.

**Failure scenario:** any validation issue that references a suggestion (rather than a resolved
edge) — reject a low-confidence suggestion's issue, click "Investigate →" — always executes
`SELECT * FROM related_table LIMIT 100;`, which 404s/errors against every real connection.

### 2. `[x]` HIGH — AskData background-completion badge can never fire

**File:** `frontend/src/app/dashboard/query-workspace/QueryWorkspaceInner.tsx:84,91-96,124-126`.

`bgAskComplete`/`setBgAskComplete` exist and are read when rendering the "Ask" toggle button's
notification dot (line 124: `{bgAskComplete && mode !== "ask" && (...)}`), but `setBgAskComplete`
is **only ever called with `false`** (inside `handleModeChange`, line 102). Nothing calls it with
`true`. Compare with the SQL side: `SqlWorkspaceView` accepts an `onBackgroundComplete` prop and
fires it on a `running: true → false` transition (`SqlWorkspaceView.tsx:74-81`), wired to
`handleSqlBackgroundComplete` in the shell. `AskDataView` has no equivalent prop at all — its own
`loading: true → false` transition (in `sendMessage`'s `finally` block) is never reported upward.

**Failure scenario:** ask a question, switch to SQL mode before the answer returns, wait for it to
arrive — task #4's spec badge ("a new AskData answer arrived while you were in SQL mode") never
appears, even though the equivalent SQL-side badge works correctly in the mirror-image scenario.

### 3. `[x]` MEDIUM — Dead `sessionStorage["qs-handoff"]` fallback left in `ChatBubble.tsx`

**File:** `frontend/src/app/dashboard/askdata/components/ChatBubble.tsx:5-8,88-95`.

Task #3 said this mechanism "becomes dead code once nothing writes that key anymore and should be
removed, not left dormant." It wasn't removed — `sendToQueryStudio()` (the
`sessionStorage.setItem("qs-handoff", ...)` + `window.location.href` pair) is still defined, and
`ChatBubble`'s button still falls back to it whenever `onEditInSql` is falsy:
```ts
onClick={() => {
  if (onEditInSql) { onEditInSql(connectionId, res.sql as string); }
  else { sendToQueryStudio(connectionId, res.sql as string); }
}}
```
Today this branch is unreachable — `AskDataView` (the only caller) always passes `onEditInSql` —
but the old `query-studio/page.tsx` was replaced by a plain redirect (`QueryStudioRedirect`,
`query-studio/page.tsx:1-11`) that no longer reads `qs-handoff` at all. If this fallback is ever
exercised again (e.g. a future refactor makes the prop optional, or `ChatBubble` gets reused
somewhere `onEditInSql` isn't threaded through), it will silently write to a key nobody reads and
hard-navigate the user to a page that immediately redirects them onward **without** their SQL —
a silent data-loss regression with no error, just a blank SQL editor.

### 4. `[x]` MEDIUM — Shipped SQL-handoff mechanism isn't the one the tests cover

**Files:** `query-workspace/QueryWorkspaceInner.tsx:46-53,71-75` vs.
`query-workspace/components/SqlWorkspaceView.tsx:31-33,60-67` vs.
`query-studio/__tests__/page.test.tsx:198-223`.

`SqlWorkspaceView` accepts `externalSqlText`/`onSqlTextApplied` props and reacts to them in a
`useEffect` — and that's exactly what the "applies externalSqlText when passed as a prop" test
exercises. But `QueryWorkspaceInner` never passes those props. Instead it reaches into the
component through `sqlViewRef.current?.setSqlText(sql)`, deferred with a bare `setTimeout(..., 0)`
"so the SQL view mounts properly" (it's unconditionally mounted per decision #1, so this
justification doesn't hold). Net effect: the tested code path is dead, and the shipped code path
(a timing-fragile imperative ref call) has zero test coverage.

### 5. `[ ]` LOW-MEDIUM — No tests for `QueryWorkspaceInner` (the shell) at all

Neither `askdata/__tests__/page.test.tsx` nor `query-studio/__tests__/page.test.tsx` renders
`QueryWorkspaceInner` — they only render `AskDataView`/`SqlWorkspaceView` directly, in isolation.
Task #8's actual point — verifying state survives a mode switch, handoff mode-precedence, the
shell-level write-confirm modal, and the background-completion badges — has no automated coverage
at all. **Fixed in this pass** — see `query-workspace/__tests__/QueryWorkspaceInner.test.tsx`.

### 6. `[ ]` LOW-MEDIUM — No tests for any of the 4 Schema Intel / Schema Mapper "Investigate →" actions

Zero coverage for `handoff.ts`'s read/write/clear round-trip, or for the `writeWorkspaceHandoff`
call sites in `DriftHistoryPanel`, `CatalogTableCard`, `SuggestionPanel`, or `ValidationPanel`.
Task #12 (tests for exactly this) wasn't done. **Fixed in this pass** — see
`query-workspace/__tests__/handoff.test.ts` and per-component tests.

### 7. `[ ]` LOW — New component tests live under the old `askdata/__tests__/` and
`query-studio/__tests__/` directories

They import from `../../query-workspace/components/...`, so they do test the right code — but
task #8 said to relocate them to `query-workspace/__tests__/`. Left as-is in this pass (moving
working, passing tests is pure churn with no behavior change); noting the deviation rather than
silently diverging from the spec. Newly-added shell/handoff tests do live in the correct
`query-workspace/__tests__/` location.

### 8. `[ ]` LOW — `ValidationPanel`'s edge-based Investigate action only reads `edge.sources[0]`

**File:** `schema-mapper/components/ValidationPanel.tsx:92-102`. For an N:1 edge (multiple
sources — a feature this codebase explicitly supports since `mapper_tasks/01`), any source past
the first is silently dropped from the scaffold query. Likely acceptable per task #11's own
"starting point, not a precise fix" framing — left open rather than fixed, since building a
correct multi-source scaffold query is a real design choice (one query per source? a UNION? just
the first?), not a one-line fix. Tracked in `enhancements.md`.

### 9. `[x]` HIGH — Write-confirm modal read `ref.current` during render; handoff effect called setState on every mount

Found via `npm run lint` (this repo's ESLint config includes the newer `react-hooks/refs` and
`react-hooks/set-state-in-effect` rules), not by manual review — recorded here since both are real
correctness issues, not lint pedantry:

- **`QueryWorkspaceInner.tsx`** rendered the shell-level `WriteConfirmModal` by reading
  `sqlViewRef.current.getResult()?.statement_type`/`.warnings` directly in JSX. Reading a ref's
  `.current` during render is unsafe — React does not guarantee the component re-renders when the
  ref's underlying value changes without an accompanying state update, so the modal's displayed
  statement type/warnings could go stale. **Fixed:** `SqlWorkspaceView` now reports
  `{statementType, warnings} | null` reactively via a new `onWriteConfirmDetailsChange` callback
  (mirroring the existing `onPendingConfirmChange` pattern), stored in real shell state
  (`writeConfirmDetails`) and read from there instead of the ref. The ref now only exposes
  `confirmWrite`/`cancelWrite` (legitimate — only ever called from event handlers, never during
  render).
- The WorkspaceHandoff-consuming effect (`useEffect(() => { ...5 setState calls...}, [])`) ran
  once on mount purely to seed initial state from `sessionStorage` — a textbook case where an
  effect-plus-setState causes an unnecessary extra render pass instead of using a lazy `useState`
  initializer. **Fixed:** `handoff` is now read once via `useState(() => readAndClearWorkspaceHandoff())`,
  and `mode`/`connectionId`/`externalSqlText`/`handoffBanner`/`prefillQuestion` all derive their
  initial value from it directly — no effect, no extra render, same precedence behavior (handoff's
  `mode` still wins over `?mode=`).

### 10. `[ ]` LOW — `CatalogTableCard`'s "Investigate →" only shows for `label === "PII"`

**File:** `schema/components/CatalogTableCard.tsx:85`. Task #10 said "at least for High-risk/PII
... optional for Public/Low," which leaves "Sensitive" ambiguous. Not a defect — a scope judgment
call. Tracked in `enhancements.md`.

## Verification after fixes

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd frontend && npx vitest run
```

All green as of this pass: `tsc --noEmit` clean, `npm run lint` clean for every file this epic
touches (remaining lint errors/warnings are pre-existing, in unrelated files — `tenants/`,
`login/page.tsx`, `schema-mapper/ExportModal.tsx`, `schema-mapper/EdgeInspector.tsx`, none touched
by this epic), `npm run build` clean (19/19 routes generated, including the new
`/dashboard/query-workspace` and the two redirect stubs), `npx vitest run` 106/106 passing (up
from 0 for this epic's own code before this pass).
