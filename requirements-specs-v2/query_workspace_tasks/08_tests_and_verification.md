# Task #8 — Consolidate tests, add mode-switch/handoff/redirect coverage, final verification

**Reference:** repo convention (`SKILLS.md` #3, #7 — "Done means" / progress-log discipline);
depends on tasks #1–#7 all landing first.

## Changes

### 1. Relocate existing suites
- `frontend/src/app/dashboard/askdata/__tests__/page.test.tsx` and
  `frontend/src/app/dashboard/query-studio/__tests__/page.test.tsx` move to
  `frontend/src/app/dashboard/query-workspace/__tests__/`, updated to import
  `AskDataView`/`SqlWorkspaceView` from their new component paths (task #1) instead of the old
  page default exports. Keep every existing assertion — this epic must not regress AskData's or
  Query Studio's own FR coverage, only relocate and adapt imports.
- Remove the sessionStorage-handoff-specific test(s) superseded by task #3
  (`query-studio/__tests__/page.test.tsx:193-206`'s "loads a query handed off from AskData via
  sessionStorage" and the corresponding assertion in `askdata/__tests__/page.test.tsx:121`) —
  replace with the new in-shell handoff test below.

### 2. New tests for this epic's own behavior
- **State survives a mode switch:** render the shell, type a partial SQL draft in SQL mode,
  switch to Ask mode, switch back, assert the draft text is still present (task #1). Same for a
  chat turn added in Ask mode surviving a round-trip through SQL mode.
- **In-place handoff:** simulate a chat turn with `res.sql` set, click "Edit in Query Studio →",
  assert `mode` becomes `"sql"` and the SQL editor's value equals the handed-off SQL — no
  `sessionStorage` involved (task #3).
- **Shared connection state:** change the connection in one mode, assert the other mode's selector
  reflects the same value without a second fetch call (task #2 — assert `api.get` for
  `/api/v1/connectors/` was called exactly once, not twice).
- **Pending write-confirmation visible across mode switch:** trigger `pendingConfirm`, switch to
  Ask mode, assert `WriteConfirmModal` is still rendered (task #4).
- **Redirects:** if feasible under this repo's test harness, assert `/dashboard/askdata` and
  `/dashboard/query-studio` redirect to `/dashboard/query-workspace` with the correct `?mode=`
  (task #6) — if the harness can't easily test Next.js `redirect()` server behavior, note that
  explicitly rather than skipping silently, and cover it in the manual verification pass instead.

### 3. Full verification pass
```bash
cd frontend && npm run lint && npm run build
cd frontend && npx vitest run   # or the repo's actual test runner invocation — confirm from package.json
```
Then the manual golden-path walkthrough, combining every mode-switch scenario from tasks #1, #3,
and #4 into one session: ask a question → edit in SQL → run a write with confirmation pending →
switch to Ask mid-confirmation → confirm modal still visible → confirm the write → switch modes a
few more times checking nothing resets → visit both old URLs directly to confirm redirects → check
Audit Trail shows both event types distinctly.

## Verify

Per repo convention (`CLAUDE.md`'s "Verify" step): don't claim done on type-check alone — the
manual walkthrough above is required, not optional, since this epic is entirely UI/state-flow
behavior that a type-checker cannot catch (a hidden component silently losing state still
type-checks cleanly).

## Risk

- This task is inherently last and broadest — if any of #1-#7 land with a caveat (e.g. task #4's
  optional badge/notification deferred, or task #6's redirect mechanism needing a different API
  than assumed per `frontend/AGENTS.md`'s warning), record that caveat here in the progress log
  rather than treating "tests pass" as full completion.
