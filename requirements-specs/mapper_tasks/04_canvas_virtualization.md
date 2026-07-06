# Task #4 — Canvas has no virtualization/search for large schemas

**TRD reference:** NFR §5 Performance — "Canvas shall render schemas of up to 50 tables /
1,000 columns within 2 seconds." TRD §10 Risks & Mitigations, row "Canvas performance on very
large schemas | Medium | **Virtualized rendering; pagination/search; lazy-load columns**" — this
is the TRD's own named mitigation for this exact risk, and none of the three named techniques are
implemented.

**Gap:** `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`'s `SchemaPanel`
(lines 257-351) renders every column in `nodes` as a real DOM node unconditionally:

```tsx
nodes.map((n) => {
  ...
  return <div key={n.id} draggable=... >...</div>;
})
```

There is no virtualization (rendering only the visible slice of a long list), no search/filter
input to narrow hundreds of columns down to the ones a user is looking for, and no lazy-loading —
`flattenSchema` (lines 237-255) eagerly flattens and renders the *entire* schema for both source
and target the moment the mapping loads. At the TRD's stated ceiling (1,000 columns across up to
50 tables, per side, so potentially 2,000 DOM nodes just for the two schema panels, plus the SVG
connector overlay recalculating on every edge change) this has never been measured against the
"within 2 seconds" NFR — there's no load test or synthetic large-schema fixture anywhere in
`backend/tests/mapping/` or the frontend to verify it.

## Changes

### 1. `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- Add a search/filter input above each `SchemaPanel` (source and target independently) that
  filters `nodes` by table or column name substring match, client-side. This alone addresses the
  most common real complaint ("I have 40 tables, I just want `customers.email`") without needing
  a virtualization library, and is the cheapest of the three TRD-named mitigations to ship first.
- Add virtualization for the column list: since this repo has no existing virtualization
  dependency, the lowest-risk option is a simple windowing implementation (render only rows
  within `containerRef`'s scroll viewport ± a buffer, computed from `rowHeight` — the panel
  already has a fixed `rowHeight = 36` constant used for connector positioning, so the same
  constant drives windowing math) rather than pulling in a new dependency — confirm with
  whoever picks this up whether adding `react-window` or `@tanstack/react-virtual` is preferable
  to a hand-rolled version; either is reasonable, hand-rolled avoids a new dependency.
- Lazy-load columns per table: currently `flattenSchema` flattens every table's columns eagerly.
  Consider grouping the panel by table with collapsed-by-default sections (expand on click) so a
  50-table schema initially renders 50 rows (collapsed table headers), not 1,000 column rows —
  this combines naturally with the search box above (searching auto-expands matching tables).
- `ConnectorOverlay`'s `nodeIndex` lookup (lines 203-209) does a linear `findIndex` over
  `sourceColumns`/`targetColumns` for every connector on every render — fine at current scale,
  but revisit if it shows up in profiling once virtualization changes the row-index math (row
  index needs to stay stable relative to the *unfiltered* full list, or connector line positions
  will jump when a search filter is active — this is the trickiest part of this task, flag it
  for design review if the windowing approach makes connector positioning awkward).

### 2. Add a synthetic large-schema fixture for manual/perf verification
- No large-schema test fixture exists today — the whole test suite uses 1-2 column tables
  (`_fake_schema` helpers throughout `backend/tests/mapping/*.py`). Add a
  `backend/scripts/seed_large_demo_schema.py` (or extend `run_e2e_demo.py`) that creates a
  SQLite connection with ~50 tables × ~20 columns for manual perf testing against the actual
  2-second NFR target — this is a one-time tool, not a pytest test, since asserting wall-clock
  render time isn't meaningful in the current backend-only test suite (there's no frontend
  render-timing harness in this repo).

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manual: load a mapping against the large synthetic schema fixture, confirm the panels render
and remain responsive to scroll/search within a couple seconds, and that search actually narrows
the visible set.

## Risk

- This is the most open-ended task in this set — the TRD names three techniques
  (virtualization, pagination/search, lazy-load) without specifying exactly which combination is
  required, and windowing interacts with the connector-line positioning math in a way that needs
  care (see the `nodeIndex` note above). Recommend implementing search/filter first (cheap, high
  value, no positioning-math risk) and treating full virtualization as a follow-up once it's
  clear search alone doesn't cover the 1,000-column ceiling.
- No automated regression coverage exists for this — verification is manual against the
  synthetic fixture until/unless a frontend testing harness is introduced for this module.
