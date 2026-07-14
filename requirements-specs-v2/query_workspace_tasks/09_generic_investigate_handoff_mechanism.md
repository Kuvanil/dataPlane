# Task #9 — Generic `WorkspaceHandoff` contract + Query Workspace consumption + context banner

**Reference:** design decision #10 in `INDEX.md`. Depends on task #1 (shell exists) and task #2
(shared connection state exists, since this handoff sets `connectionId` into that same state).

**Why this is a new mechanism, not a reuse of task #3's work:** task #3 removes
`sessionStorage["qs-handoff"]` between AskData and Query Studio because that pair becomes the same
page. Schema Intel (`/dashboard/schema`) and Schema Mapper (`/dashboard/schema-mapper`) are not
part of this merge — they stay separate routes — so a real cross-page handoff is still the only
option, just generalized to carry richer context and to originate from more than one source.

## Changes

### 1. New shared type, e.g. `frontend/src/app/dashboard/query-workspace/lib/handoff.ts`
```ts
export type WorkspaceHandoff = {
  connectionId: number;
  mode: "ask" | "sql";
  sql?: string;
  prefillQuestion?: string;
  banner: { sourceModule: "schema_intel" | "schema_mapper"; summary: string };
};

const HANDOFF_KEY = "query-workspace-handoff";

export function writeWorkspaceHandoff(payload: WorkspaceHandoff): void {
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
}

export function readAndClearWorkspaceHandoff(): WorkspaceHandoff | null {
  const raw = sessionStorage.getItem(HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(HANDOFF_KEY);
  try {
    return JSON.parse(raw) as WorkspaceHandoff;
  } catch {
    return null;
  }
}
```
Exporting `writeWorkspaceHandoff` from a shared module (rather than duplicating the
`sessionStorage.setItem` call inline in Schema Intel and Schema Mapper components, per tasks
#10/#11) keeps the key name and payload shape defined in exactly one place.

### 2. `query-workspace/page.tsx` (the shell)
- On mount, call `readAndClearWorkspaceHandoff()` — same read-once-then-remove timing
  requirement the old `qs-handoff` effect had (must run before the connections fetch resolves, so
  its default-to-first-connection logic doesn't override the handoff's `connectionId`).
- If a handoff is present: set `connectionId`, set `mode`, and either populate `sqlText` (via
  whatever mechanism task #3 built for `SqlWorkspaceView`) or `prefillQuestion` (populate
  `AskDataView`'s input field, **not** auto-sent — the user should see and be able to edit the
  question before it goes out, since it's not their own words).
- Store `banner` in state; render a dismissible banner above both subviews, e.g. "📋 Investigating:
  {summary} — from {sourceModule display name}". Dismiss just clears the banner state, it doesn't
  undo the applied `connectionId`/`mode`/prefill.

### 3. `?mode=` query param precedence
- If both a `?mode=` param (from task #6's redirects) and a `WorkspaceHandoff` are present (e.g. a
  user followed a Schema Intel link that also happens to carry `?mode=sql`), the handoff's `mode`
  wins — it's the more specific, richer signal.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: manually `sessionStorage.setItem("query-workspace-handoff", JSON.stringify({...}))` in
the browser console, navigate to `/dashboard/query-workspace`, confirm the connection/mode/
prefill/banner all apply correctly and the key is cleared after (revisit the page — banner should
be gone, no handoff re-applied).

## Risk

- Low — this is infrastructure with no user-facing entry point yet (tasks #10/#11 are what
  actually let a user trigger one). Safe to land and verify in isolation before either producer
  exists.
