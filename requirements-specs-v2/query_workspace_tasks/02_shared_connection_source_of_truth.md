# Task #2 — Single connection fetch/state lifted into the shell

**Reference:** design decision #2 in `INDEX.md`.

**Gap this prevents:** `askdata/page.tsx:29-36` and `query-studio/page.tsx:47-54` each run their
own `api.get<Connection[]>("/api/v1/connectors/")` and their own `connectionId` state, both
defaulting to `data[0].id`. Two separate pages doing this is harmless — a user is only ever looking
at one at a time. Once both subviews are mounted simultaneously under one shell (task #1), two
independent copies of this state become a real hazard: nothing stops them from silently disagreeing
about which connection is "current," and the UI gives no indication if they do.

## Changes

### 1. `query-workspace/page.tsx` (the shell from task #1)
- Fetch `GET /api/v1/connectors/` once, own `connections: Connection[]` and
  `connectionId: number | null` state at the shell level.
- Pass `connections` and `connectionId`/`setConnectionId` down as props to both
  `AskDataView` and `SqlWorkspaceView`.

### 2. `AskDataView.tsx` / `SqlWorkspaceView.tsx`
- Remove their own `connections`/`connectionId` `useState` + fetch effects; accept them as props
  instead. Each still renders its own connection-picker component (`ConnectionPicker` /
  `ConnectionSelector`) — those don't need to be unified into one component in this task, just fed
  from the same state so picking a connection in either mode updates the same value the other mode
  sees immediately on next render.
- `SqlWorkspaceView`'s catalog-tables and saved-queries fetches
  (`query-studio/page.tsx:56-64`, keyed on `connectionId`) stay in that subview — they're
  SQL-mode-specific, not shared state.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: in the merged tab, switch the connection while in Ask mode, then switch to SQL mode and
confirm the connection selector shows the same connection (not the independent default). Reverse
the direction (change in SQL mode, check Ask mode reflects it).

## Risk

- Low — this is a state-lifting refactor with no new behavior, just removing a duplicate fetch.
  The main thing to verify is that both subviews' `useEffect`s that depend on `connectionId`
  (catalog tables, saved queries in SQL mode) still fire correctly once `connectionId` comes from
  a prop instead of local state — dependency arrays don't need to change, but confirm no
  stale-closure issue is introduced by the prop-drilling.
