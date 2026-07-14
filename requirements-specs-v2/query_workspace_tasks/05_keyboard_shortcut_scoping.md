# Task #5 — Scope Enter/Cmd+Enter key handlers to the active mode

**Reference:** design decision #6 in `INDEX.md`.

**Gap:** `AskDataView`'s input (`askdata/page.tsx:120`) sends on `onKeyDown` when
`e.key === "Enter"`. `SqlWorkspaceView`'s editor (`query-studio/components/SqlEditor.tsx`, invoked
via `onRun` in `query-studio/page.tsx:170`) runs the query on Cmd/Ctrl+Enter. Today only one of
these can ever be mounted, so there's no conflict. After task #1, both are mounted simultaneously
— if either handler is attached at a level broader than its own focused input (e.g. a
document-level listener, or one that isn't gated on visibility), a keystroke intended for the
visible mode could theoretically also be observed by the hidden one.

## Changes

### 1. Audit both handlers' actual scope
- `AskDataView`'s `onKeyDown` is on the `<input>` element itself (`askdata/page.tsx:119-120`) — it
  only fires when that specific input is focused, which already can't happen while its container is
  `hidden` (a `display: none` element can't hold focus). Confirm this holds after the refactor;
  if so, no change needed here beyond verification.
- `SqlEditor`'s Cmd/Ctrl+Enter binding — check whether CodeMirror 6's keymap extension
  (`@codemirror/lang-sql` / custom keymap in `SqlEditor.tsx`) is scoped to the editor's own focused
  view (standard CodeMirror behavior) or attached more broadly. CodeMirror keymaps are
  editor-view-scoped by default, so this should already be safe — verify, don't assume.

### 2. If either handler turns out to be attached at `window`/`document` level
- Gate it with the shell's `mode` state (pass `mode` down or check an `isActive` prop) so the
  handler no-ops when its subview isn't the active one, in addition to the focus-based protection.
  This is a defensive belt-and-suspenders addition only if the audit in step 1 finds a
  document-level listener; if both handlers are confirmed element-scoped (the expected outcome
  given the current code), this task closes as "verified, no change needed" rather than adding
  unnecessary indirection.

## Verify

Manually: with SQL mode active and the editor focused, switch to Ask mode, type a question ending
in Enter — confirm only the chat sends and no query runs in the (hidden) SQL editor. Reverse:
with Ask mode active, switch to SQL mode, put text in the editor, press Cmd/Ctrl+Enter — confirm
only the query runs and no chat message is sent from residual state.

```bash
cd frontend && npx tsc --noEmit && npm run build
```

## Risk

- Low — both handlers are almost certainly already element/focus-scoped given the current
  implementation (a plain `<input onKeyDown>` and a CodeMirror view keymap), so this task is
  expected to be mostly verification with little or no code change. Don't add speculative
  `mode`-gating if the audit shows it isn't needed — that would be an unrequested abstraction for a
  problem that doesn't exist.
