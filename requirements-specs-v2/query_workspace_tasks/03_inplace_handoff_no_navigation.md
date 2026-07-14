# Task #3 — Replace sessionStorage handoff with an in-shell callback

**Reference:** design decision #3 in `INDEX.md`.

**Current mechanism (to be replaced):**
- `askdata/components/ChatBubble.tsx:5-8`:
  ```ts
  function sendToQueryStudio(connectionId: number, sql: string) {
    sessionStorage.setItem("qs-handoff", JSON.stringify({ connectionId, sql }));
    window.location.href = "/dashboard/query-studio";
  }
  ```
- `query-studio/page.tsx:34-45` reads and clears `sessionStorage["qs-handoff"]` in a mount-time
  effect, with a comment noting it must run "before the async connections fetch below resolves."

This exists only because AskData and Query Studio are on different pages, so the only way to pass
data between them is a full navigation plus a storage-backed payload the next page reads on mount.
Once both live under one shell (task #1) with `connectionId` already shared (task #2), a direct
function call is strictly simpler and removes an entire class of timing bug (the comment about
effect-ordering above is exactly the kind of fragility this removes).

## Changes

### 1. `query-workspace/page.tsx` (shell)
- Add a handler, e.g. `handleEditInSql(connectionId: number, sql: string)`, that sets the shell's
  `connectionId` (task #2's shared state) and calls a setter passed down to `SqlWorkspaceView` to
  populate its `sqlText`, then sets `mode = "sql"`.
- `SqlWorkspaceView` needs an externally-settable SQL text — either lift `sqlText` state up
  alongside `connectionId`, or expose an imperative setter via a ref/callback prop. Prefer lifting
  `sqlText` to the shell only if task #4's guardrail work doesn't already need to reach into
  `SqlWorkspaceView`'s internals for the pending-confirm check — otherwise keep `sqlText` local and
  pass a `setSqlText` callback down via a ref (`useImperativeHandle`) to avoid re-rendering
  `SqlWorkspaceView` on every keystroke from the shell. Pick whichever keeps `SqlWorkspaceView`'s
  existing internals most intact; this is an implementation-detail choice, not a behavior one.

### 2. `AskDataView.tsx` (formerly `ChatBubble.tsx`'s caller)
- Pass `onEditInSql: (connectionId: number, sql: string) => void` down to `ChatBubble` as a prop,
  replacing the module-level `sendToQueryStudio` function.
- `ChatBubble.tsx`: replace the `sendToQueryStudio` call with `onEditInSql(connectionId, res.sql)`;
  remove the `sessionStorage`/`window.location.href` lines entirely.

### 3. `SqlWorkspaceView.tsx` (formerly `query-studio/page.tsx`)
- Delete the mount-time `sessionStorage.getItem("qs-handoff")` effect (lines 34-45 of the original
  `query-studio/page.tsx`) — nothing writes that key anymore after this task, so the effect is dead
  code, not a fallback to keep.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: ask a question in Ask mode that returns SQL, click "Edit in Query Studio →", confirm the
view switches to SQL mode instantly (no page reload/flash), the same connection stays selected, and
the SQL editor is pre-filled with the generated query — with the chat history still present when
switching back to Ask mode.

## Risk

- Grep the frontend for any other reader of `sessionStorage["qs-handoff"]` before deleting the
  writer/reader pair — confirmed via this epic's audit that only `ChatBubble.tsx` (writer) and
  `query-studio/page.tsx` (reader) touch that key, but re-check at implementation time in case
  something changed.
- Task #8's test suite must update/remove the existing test asserting the sessionStorage handoff
  (`query-studio/__tests__/page.test.tsx:193-206` and the corresponding assertion in
  `askdata/__tests__/page.test.tsx:121`) and replace it with a same-page mode-switch assertion.
