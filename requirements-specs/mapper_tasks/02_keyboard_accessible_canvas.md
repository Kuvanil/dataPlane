# Task #2 — Drag-and-drop edge creation has no keyboard alternative

**TRD reference:** NFR §5 Usability — "keyboard-accessible (WCAG 2.1 AA)." Fails WCAG 2.1.1
(Keyboard): all functionality must be operable through a keyboard interface without requiring
specific timings for individual keystrokes.

**Gap:** `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`'s `SchemaPanel`
sub-component (lines 257-351) implements edge creation exclusively via native HTML5 drag-and-drop
(`draggable`, `onDragStart`, `onDragOver`, `onDrop`). There is no way to create, select, or
inspect a mapping edge using only a keyboard — a keyboard-only or switch-device user cannot use
the core interaction of this feature at all.

Note: task #1 (N:1 UI) is adding a click-to-select-source mechanism for multi-source mapping.
This task should build on top of that rather than duplicate it — the click-select interaction
task #1 introduces is itself a reasonable keyboard-operable primitive if column rows are made
focusable and respond to Enter/Space, so implement task #1 first (or in the same pass) and treat
this task as "make the click-select-then-click-target flow keyboard operable and give it visible
focus states," rather than building a second, separate interaction model.

## Changes

### 1. `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- Change each column row in `SchemaPanel` from a plain `<div>` to a `<button type="button">` (or
  a `<div role="button" tabIndex={0}>` with `onKeyDown` handling `Enter`/`Space`) so every column
  is a real focusable, keyboard-activatable control.
- Source columns: pressing Enter/Space toggles the column into the "staged sources" selection
  (same state task #1 introduces for click-select).
- Target columns: pressing Enter/Space, when ≥1 source is staged, creates the edge against that
  target — same code path as a mouse click, per task #1.
- Add a visible focus ring (`focus-visible:ring-2 focus-visible:ring-blue-400`) to every column
  row — currently there's no `:focus` styling at all on these interactive elements.
- Announce staged-source count changes via an `aria-live="polite"` region (the page already has
  one for toasts at `page.tsx:245-247` — reuse the pattern, don't introduce a second one) so a
  screen reader user gets feedback equivalent to the sighted "N sources selected" pill from
  task #1.
- Connector lines in `ConnectorOverlay` (lines 353-421) are already clickable via `onClick` to
  select an edge, but are SVG `<g>` elements with no keyboard path either — add `tabIndex={0}`,
  `role="button"`, and an `onKeyDown` handler (Enter/Space → `onSelectEdge(c.edgeId)`) to each
  connector group, matching the mouse behavior.

### 2. `frontend/src/app/dashboard/schema-mapper/components/EdgeInspector.tsx`
- Already keyboard-operable (`<button>` elements throughout for Edit/Delete) — no change needed,
  confirmed while scoping this task. Listed here only so the audit trail for this task is
  complete: the inspector was checked and is fine.

### 3. Manual verification (no automated a11y test harness exists in this repo)
- Tab through the full Canvas using only the keyboard: reach a source column, select it with
  Space, tab to a target column, connect with Enter, confirm an edge is created and the focus
  ring is visible throughout.
- Run the browser's built-in accessibility audit (Chrome DevTools → Lighthouse → Accessibility,
  or the Accessibility panel) against `/dashboard/schema-mapper` before/after and confirm the
  "Interactive elements are keyboard focusable" and related checks move from fail to pass for
  this page.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Plus the manual keyboard walkthrough above — this task cannot be fully verified by the existing
automated suite since there's no component/interaction test harness for the frontend in this
repo today.

## Risk

- Turning column rows into `<button>` elements changes their default browser styling (buttons
  have different default padding/border/background than divs) — verify the existing Tailwind
  classes still render identically, or add `className="... appearance-none bg-transparent
  border-0 ..."` resets as needed so this is a pure accessibility fix with no visual regression.
- This is additive (new keyboard path alongside existing mouse/drag path) — the existing
  drag-and-drop flow must keep working unchanged.
