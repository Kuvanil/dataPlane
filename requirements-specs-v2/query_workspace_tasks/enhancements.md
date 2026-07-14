# Query Workspace epic — enhancement ideas (post-build review)

> Not bugs — the current behavior is defensible — but worth recording as deliberate follow-ups
> rather than losing them. None of these block the epic; none are built in this pass unless noted.

## 1. Validate a handed-off `connectionId` against the fetched connection list

`writeWorkspaceHandoff` payloads carry a raw `connectionId` from Schema Intel/Mapper. If that
connection is later deleted, or a stale sessionStorage entry survives across a connection change,
`QueryWorkspaceInner` applies it without checking it's actually in `connections`. The native
`<select>`-based pickers (`ConnectionPicker`/`ConnectionSelector`) degrade gracefully (they just
won't show a matching option selected) rather than crashing, so this is low severity — but a
banner like "connection no longer available" would be clearer than a silently-blank picker.

## 2. Multi-source scaffold queries in Schema Mapper's Investigate actions

`ValidationPanel`'s edge-based action only reads `edge.sources[0]` (bugs.md #8). A real fix needs
a product decision: one query per source? A query with all source columns projected together? Just
document which source was picked in the banner text (e.g. "showing source 1 of 3")? Pun​t to a
follow-up rather than guessing.

## 3. Extend `CatalogTableCard`'s "Investigate →" to "Sensitive", not just "PII"

Currently gated on `label === "PII"` only (bugs.md #9). "Sensitive"-classified columns are a
plausible candidate for the same action. Small change if/when product confirms the scope.

## 4. Persist `mode` in the URL on manual toggle

`handleModeChange` updates `mode` state but doesn't call `router.replace` to reflect it in
`?mode=`. A page refresh always falls back to the initial `?mode=` param (or "ask" default)
rather than wherever the user last was. Small addition: `router.replace(`/dashboard/query-
workspace?mode=${newMode}`, { scroll: false })` alongside `setMode`.

## 5. Shared `navigateToWorkspace(handoff)` helper

The `writeWorkspaceHandoff({...}); router.push("/dashboard/query-workspace");` pair is duplicated
five times across `DriftHistoryPanel`, `CatalogTableCard`, `SuggestionPanel`, and `ValidationPanel`
(x2). A one-line helper in `handoff.ts` (`navigateToWorkspace(router, payload)`) would remove the
duplication and be the one place to change if e.g. an open-in-new-tab option is ever wanted.

## 6. Redirect pages have no test coverage

`AskDataRedirect`/`QueryStudioRedirect` are simple enough that a test is low-value, but task #8
asked to "note explicitly rather than skip silently" if redirects can't be easily tested under
this harness — recorded here per that instruction.

## 7. aria-labels on the new Investigate buttons in `DriftHistoryPanel` / `CatalogTableCard`

`SuggestionPanel`/`ValidationPanel`'s Investigate buttons already have `aria-label`s;
`DriftHistoryPanel`'s and `CatalogTableCard`'s don't. Minor a11y consistency gap, in the spirit of
the accessibility work already done for Schema Mapper's Canvas (`mapper_tasks/02`).

## 8. Visual feedback on click before the route change

`router.push("/dashboard/query-workspace")` isn't instantaneous; there's no loading/pressed state
on the Investigate buttons in the interim. Minor polish, not required.
