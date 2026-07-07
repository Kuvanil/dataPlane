# Dashboard Static/Mock UI — Task Index

> Source: user report 2026-07-06 ("schema mapper tab always shows same tables, no dropdown,
> still static") — triage traced the screenshot to the **Visualize** tab and, while checking,
> found the **dashboard home** page is largely hardcoded string literals. Both violate the
> repo non-negotiable: "No placeholder/mock UI — wire buttons to real endpoints or don't ship
> them" (CLAUDE.md / prompts).
>
> Scope: `frontend/src/app/dashboard/page.tsx`, `frontend/src/app/dashboard/visualize/page.tsx`.
> Backend endpoints already exist for everything needed — no backend changes required:
> `GET /api/v1/connectors/`, `POST /api/v1/connectors/{id}/test`, `GET /api/v1/audit/`,
> `GET /api/v1/audit/summary`, `GET /api/v1/mappings/` (paginated, has `total`).

## Status legend
- `[ ]` not started · `[~]` in progress · `[x]` completed · `[!]` blocked · `[?]` needs human input

## Priority order (top → bottom)

| # | Severity | Area | Status | Title |
|---|---|---|---|---|
| 1 | HIGH | home | [x] | Metric tiles are string literals ("5 sources / 15 tables / 14 AI matches / 8 PII") — wire to real APIs, drop unbacked tiles |
| 2 | HIGH | home | [x] | "Recent Activity" feed is 6 fabricated entries with fake relative times — wire to `GET /audit/` |
| 3 | MEDIUM | home | [x] | "Connection Health" card is 5 fabricated rows with invented health % — wire to connectors list + real `/test` status |
| 4 | MEDIUM | visualize | [x] | Connection pickers are unlabeled bare selects + auto-select hardcodes magic ids 1/2 — label them, default to first two connectors from the API |
| 5 | MEDIUM | visualize | [x] | Infinite "Building database graph…" spinner when auto-pick fails (<2 connectors, or ids 1/2 absent) — `loading` starts true and nothing clears it; add a pick-connections empty state |

## Finding details

### #1 Metric tiles (HIGH) — `dashboard/page.tsx:26-30`
All four tiles are literals. Honest replacements, all backed by live endpoints:
- **Connected Sources** → `connectors.length` + distinct types as the subtitle.
- **Mappings** → `GET /mappings/?limit=1` → `total` (replaces the unbacked "AI Matches Found
  14 / 92%" tile — suggestion confidence isn't aggregated anywhere server-side).
- **Audit Events** → `GET /audit/summary` → `total` (replaces the unbacked "PII Columns 8"
  tile — classification runs on demand and isn't persisted as a count).
- **Drift Events** → `summary.by_event_type["schema_drift_detected"].total`, red accent.
Dropping "Total Tables 15": counting real tables means a full schema fetch per connector on
every dashboard load, or depending on a schema-catalog scan having run. Not worth it for a
vanity tile; can return later backed by the catalog.

### #2 Activity feed (HIGH) — `dashboard/page.tsx:84-90`
Six invented rows ("Matched 14 columns… 2m ago"). Replace with `GET /audit/?page_size=8`:
event_type → icon/category bucket, actor shown, real relative time computed from
`created_at`, status=failure tinted red. Empty state: "No activity yet — connect a source or
create a mapping."

### #3 Connection health (MEDIUM) — `dashboard/page.tsx:112-117`
Five invented rows with made-up percentages. Replace with the real connector list; on load,
fire `POST /connectors/{id}/test` for each (parallel, `allSettled`) and show a truthful
Connected/Failed badge (+ testing spinner state). The fake health-% bar goes away — nothing
real backs a percentage.

### #4 Visualize pickers (MEDIUM) — `visualize/page.tsx:94-104, 182-201`
`fetchConnections` hardcodes `setSourceId(1)` / `setTargetId(2)` — works only because seed
ids happen to be 1/2, and always opens on the same pair (the user's actual complaint).
Default to `data[0].id` / `data[1].id` instead. The two selects have no visible label —
prefix them with "Source" / "Target" text labels so they read as pickers, not buttons.

### #5 Visualize stuck spinner (MEDIUM) — `visualize/page.tsx:86, 106-137`
`loading` initializes `true` and only `fetchGraph` ever clears it — but `fetchGraph` is
gated on both ids being set. With <2 connectors (or, pre-#4, ids 1/2 missing) the page spins
forever. Initialize `loading=false` and render an explicit "pick a source and target
connection" empty state when either id is null.

## Execution order

1. **#4 + #5** — small, same file, directly answer the user's report. Land first.
2. **#1 + #2 + #3** — one pass over `dashboard/page.tsx` (shared data fetching).

## Confidence per task

All HIGH — endpoints verified against the running API before filing; no design decisions
beyond dropping fabricated numbers that have no backing data (mandated by the repo's
no-mock-UI rule).

## Progress log

- 2026-07-06 — triage done, 5 tasks filed. Build starts with #4/#5.
- 2026-07-06 — **All 5 done.**
  - **#4** `visualize/page.tsx`: auto-pick now uses `data[0].id`/`data[1].id` (first two
    connectors, any ids); the two selects got visible "📤 Source" / "📥 Target" labels so they
    read as pickers, not view-mode buttons.
  - **#5** `visualize/page.tsx`: `loading` initializes false; a new empty state renders when
    either id is unset — "Pick a source and a target connection above", with an extra hint when
    <2 connections exist (add one on the Connectors tab).
  - **#1** `dashboard/page.tsx`: tiles now = Connected Sources (`GET /connectors/`, distinct
    types as subtitle), Mappings (`GET /mappings/?limit=1` → total), Audit Events
    (`GET /audit/summary` → total), Drift Events (summary by_event_type, red when >0). The
    unbacked "Total Tables 15", "AI Matches 14 / 92%", "PII Columns 8" tiles are gone —
    nothing server-side aggregates those numbers. Unloaded/failed fetches render "—", never a
    made-up value.
  - **#2** `dashboard/page.tsx`: activity feed = `GET /audit/?page_size=8`; event_type
    humanized + bucketed to icon categories (ai/audit/system), failure status tinted red, real
    relative timestamps (`timeAgo` from `created_at`), actor + connection name shown. Empty
    state for a fresh install.
  - **#3** `dashboard/page.tsx`: connection health = real connector list; each row fires
    `POST /connectors/{id}/test` in parallel on load and shows testing-spinner →
    ● Connected / ● Failed. The invented health-% bars are gone. Empty state links to the
    Connectors tab.
  - Verification: `tsc --noEmit` clean; `next lint` 30 problems — identical to the
    pre-existing baseline (zero new); production build via the frontend image rebuild; live
    smoke checks against the running stack recorded below.
