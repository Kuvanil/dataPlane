# Task #6 — Collapse sidebar entries into one tab; redirect old routes

**Reference:** design decision #7 in `INDEX.md`.

## Changes

### 1. `frontend/src/app/dashboard/layout.tsx`
- Remove the two separate menu items (lines 18-19: `query-studio` 💬 and `askdata` 🤖) and replace
  with a single entry, e.g.:
  ```ts
  { id: "query-workspace", label: "Query Workspace", icon: "💬", href: "/dashboard/query-workspace" },
  ```
  (label/icon are a product-facing choice — "Query Workspace" is a placeholder that clearly
  communicates "both," swap if the team prefers different naming; keep exactly one entry).
- The pulsing "online" indicator currently tied to `item.id === "askdata"` (`layout.tsx:42`) moves
  to the new single entry's `id`, since the AskData chat capability still exists inside it — decide
  whether it should always pulse (as today) or only pulse while `mode === "ask"` is the last-used
  mode. Simplest and consistent with today's always-on behavior: keep it unconditional on the new
  merged entry.

### 2. Redirect the old routes
- Replace `frontend/src/app/dashboard/askdata/page.tsx` with a minimal redirect:
  ```tsx
  import { redirect } from "next/navigation";
  export default function AskDataRedirect() {
    redirect("/dashboard/query-workspace?mode=ask");
  }
  ```
  Same pattern for `frontend/src/app/dashboard/query-studio/page.tsx` → `?mode=sql`. Check this
  Next.js version's actual `redirect()` API/behavior in `node_modules/next/dist/docs/` before
  writing this — per `frontend/AGENTS.md`, this Next.js build has breaking changes from the
  training-data-familiar version; confirm server vs. client component redirect semantics here
  rather than assuming.
- Move the two old feature directories' non-page files (`components/`, `lib/types.ts`) — these
  become the new `query-workspace/components/AskDataView.tsx`'s and
  `query-workspace/components/SqlWorkspaceView.tsx`'s dependencies per task #1; don't leave
  duplicate copies under the old paths once task #1 has relocated them.

### 3. Anywhere else that links to the old paths
- Grep the frontend for hardcoded `/dashboard/askdata` or `/dashboard/query-studio` links (e.g. any
  cross-feature "go to Query Studio" buttons, docs, or the Audit Trail UI if it renders clickable
  module links) and update them to the new route with the appropriate `?mode=`.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manually: visit `/dashboard/askdata` directly (simulating an old bookmark) and confirm it lands on
`/dashboard/query-workspace` with Ask mode active; same for `/dashboard/query-studio` → SQL mode.
Confirm the sidebar shows exactly one entry for this feature and no dead link to the removed
entries elsewhere in the UI.

## Risk

- `frontend/AGENTS.md` explicitly warns this Next.js version differs from training-data
  assumptions about routing/redirects — verify the redirect mechanism against this repo's actual
  `node_modules/next` before assuming standard App Router `redirect()` behavior holds.
- If the Audit Trail UI renders any clickable "view in Query Studio" / "view in AskData" links
  from stored audit events, those need the same URL update — cross-check with task #7.
