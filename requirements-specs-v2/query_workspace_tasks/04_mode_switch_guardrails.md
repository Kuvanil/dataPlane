# Task #4 — Guardrails: pending write-confirmation modal + in-flight requests across a mode switch

**Reference:** design decisions #4 and #5 in `INDEX.md`.

**Why this needs its own task:** task #1 keeps both subviews mounted so nothing is silently
destroyed by a mode switch — but "not destroyed" isn't automatically "handled correctly." Two
specific states need explicit design, not just default React behavior:

## Edge case A — pending write-confirmation modal

`SqlWorkspaceView` (formerly `query-studio/page.tsx:245-252`) renders `WriteConfirmModal` when
`pendingConfirm` is true, gating an admin's confirmed INSERT/UPDATE/DELETE/DDL. Today the modal is
rendered inline inside the SQL page's JSX tree. Once `SqlWorkspaceView` can be hidden behind
`className="hidden"` (task #1) while `mode === "ask"`, a modal rendered *inside* that hidden
container would disappear along with it — the user would never see the confirmation dialog again,
and `pendingConfirm` would sit `true` forever with no visible way to confirm or cancel the write.

**Fix:** hoist `WriteConfirmModal`'s render to the shell (`query-workspace/page.tsx`), same
pattern as a portal/overlay — `SqlWorkspaceView` still owns `pendingConfirm`/`result`/`confirmWrite`
state, but exposes them (via lifted state or a ref) so the shell can render the modal unconditionally
regardless of `mode`. This guarantees a pending write confirmation is always visible and blocking,
never hidden by a mode switch.

Decide alongside this: should switching to Ask mode while a write confirmation is pending be
*allowed* at all? Recommendation — allow it (don't block the toggle itself), but keep the modal
visible as an overlay above both subviews so the user sees it regardless of which mode tab is
selected. Blocking the toggle outright would be more restrictive than today's behavior (today you
simply can't navigate away without losing the in-memory state anyway, since it's a different page);
the overlay approach is strictly better than both today's implicit behavior and a hard block.

## Edge case B — in-flight request during a mode switch

- `AskDataView.sendMessage` (formerly `askdata/page.tsx:40-66`) sets `loading`, awaits
  `api.post(".../askdata/ask")`, then updates `turns`. If the user switches to SQL mode mid-await,
  this `await` is on a component that stays mounted (task #1), so the request completes normally
  and `setTurns`/`setLoading` fire on the still-mounted-but-hidden component with no error — this
  is the correct behavior and falls out of task #1 for free. This task's job is to **verify** it,
  not build new machinery: confirm no early-return/cleanup logic keyed on visibility accidentally
  short-circuits the promise chain (there is none in the current code — the effect that scrolls
  `endRef.current?.scrollIntoView` runs against a `ref` that's still attached to the DOM even when
  the parent has `display: none`, which is harmless but worth confirming doesn't throw).
- Same check for `SqlWorkspaceView.runQuery` — confirm a query started in SQL mode and left
  running while the user switches to Ask mode completes and updates `result`/`history` normally.
- Add a small visual affordance so the user knows something finished in the background: a subtle
  badge/dot on the inactive mode's toggle button when that mode's `loading`/`running` transitions
  from true to false while it isn't the active mode (e.g. "a new AskData answer arrived while you
  were in SQL mode"). This is a UX nicety, not a correctness requirement — implement it if time
  allows within this task; if deferred, note it explicitly in the progress log rather than
  silently skipping it.

## Verify

Manually:
1. Trigger a write in SQL mode (e.g. a DELETE against a test connection) as an admin, get the
   confirmation modal, switch to Ask mode without confirming or cancelling — confirm the modal is
   still visible and functional.
2. Ask a question in Ask mode, immediately switch to SQL mode before the response returns, wait,
   switch back to Ask mode, confirm the answer appeared correctly with no duplicate/missing turn.
3. Run a SQL query, immediately switch to Ask mode, wait, switch back, confirm results rendered.

```bash
cd frontend && npx tsc --noEmit && npm run build
```

## Risk

- The "background completion" behavior is mostly a *consequence* of task #1's mount-preserving
  design rather than new code — the main risk is regression-testing this false-negative (i.e.
  confirming it actually works) rather than implementation complexity.
- The badge/notification affordance is optional polish; don't let it block the rest of the epic if
  it turns out to need more design time than expected — defer and flag rather than gold-plate.
