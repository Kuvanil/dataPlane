# Task #1 — Shared workspace shell + Ask/SQL mode toggle

**Reference:** merge goal in `INDEX.md`; design decision #1 ("keep both subviews mounted").

**Goal:** One dashboard route hosts both the AskData chat and the Query Studio SQL editor,
switched by a segmented control, without either subview losing state when hidden.

## Changes

### 1. New route: `frontend/src/app/dashboard/query-workspace/page.tsx`
- Renders a shell: a header row with a segmented `Ask` / `SQL` toggle (two buttons, active state
  styled like the existing `sidebarTab` toggle pattern already used in Query Studio's history/saved
  panel, `query-studio/page.tsx:222-235`, for visual consistency), then both subviews in the body.
- `mode` state: `useState<"ask" | "sql">`, initialized from a `?mode=` search param if present
  (needed by task #6's redirects), defaulting to `"ask"`.
- Render **both** `<AskDataView />` and `<SqlWorkspaceView />` unconditionally; wrap each in a
  container toggled with `className={mode === "ask" ? "" : "hidden"}` (and the inverse for the
  other) — never `{mode === "ask" && <AskDataView/>}`, which would unmount the losing side. This
  is the load-bearing decision: it's what makes chat history, SQL draft text, scroll position, and
  any in-flight request survive a switch, and it removes the need for cross-page state persistence
  entirely (session storage handoff, redundant fetches) that today's two-page setup relies on.

### 2. Extract the two page bodies into subview components
- Move the JSX/logic currently in `askdata/page.tsx` into
  `query-workspace/components/AskDataView.tsx`, and `query-studio/page.tsx`'s into
  `query-workspace/components/SqlWorkspaceView.tsx`. Keep each subview's internal state
  (`turns`, `sqlText`, `result`, etc.) local to that component — only `connections`/`connectionId`
  moves up to the shell (task #2) and only the handoff payload moves up (task #3). Everything else
  (chat turns, SQL editor contents, results, history/saved panels) stays exactly where it is today.
- Reuse the existing subcomponents unchanged (`ChatBubble`, `ConnectionPicker`, `SqlEditor`,
  `ResultsTable`, `HistoryPanel`, `SavedQueriesPanel`, `WriteConfirmModal`) — this task doesn't
  restyle them, just relocates the two page-level components that assemble them.

### 3. Old page files
- `askdata/page.tsx` and `query-studio/page.tsx` become thin re-exports or get replaced by
  redirects in task #6 — don't delete them in this task; task #6 owns that.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: open `/dashboard/query-workspace`, confirm Ask mode renders the chat with a working
connection picker and send flow, switch to SQL mode and confirm the editor/results/sidebar render,
type a partial SQL draft, switch back to Ask and back to SQL again, and confirm the draft text is
still there (proves the mounted-not-remounted behavior actually holds, not just that the toggle
visually switches).

## Risk

- The two existing pages have slightly different outer layout assumptions (AskData is a single
  flex column filling `h-full`; Query Studio is a `flex h-full` with a `flex-1` main area plus a
  `w-72` right sidebar). Keeping both mounted stacked in the DOM means the hidden one still
  occupies no layout space only if `hidden` (Tailwind's `display: none`) is applied at the
  outermost wrapper of each subview — verify neither subview leaks height/scroll into the other
  when hidden.
