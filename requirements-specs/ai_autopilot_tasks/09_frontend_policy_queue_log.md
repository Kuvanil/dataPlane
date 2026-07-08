# Task 09 — Frontend: policy panel + approval queue + action log

**TRD:** AUTO-T1/T4/T6, Usability NFR ("clear rationale and reversibility info per action;
obvious approve/reject controls").

## Scope — `frontend/src/app/dashboard/autopilot/`

Restructure `page.tsx` into tabs/sections, keeping the existing run console working:
1. **Run console** (existing behavior; `mode=execute` now surfaces the 202 "queued for
   approval" response by deep-linking the user to the Approval queue tab).
2. **Policy** — table of action types from `GET /autopilot/policy`: description, risk badge,
   reversibility badge, autonomy `<select>` (options constrained: `auto` disabled with a
   tooltip when not auto-capable), max-auto-per-hour input. Save via
   `PUT /autopilot/policy/{action_type}`. Controls visible but disabled for non-admin
   (with an explanatory hint) — same role pattern as the mapper.
3. **Approval queue** — pending recommendations: action type, subject, confidence %, risk +
   reversibility badges, rationale summary + expandable evidence list, created-at. Buttons:
   Approve (admin), Reject (admin), Modify (admin — JSON payload editor pre-filled, validated
   server-side). Non-pending statuses reachable via a status filter.
4. **Action log** — `GET /autopilot/actions`: outcome chip (success/failure/blocked_*),
   mode (auto/approved), actor, reversibility note, detail expandable.

## Rules

- All HTTP through `frontend/src/lib/api.ts` — no parallel fetch paths.
- No mock/placeholder data; every control wired to a real endpoint or not shown.
- Draft-only affordances lesson from the mapper applies: gate controls on **state**, not role
  alone (e.g. approve buttons only on `pending` rows).
- Follow existing dashboard styling (zinc/violet palette, chips/badges as in SuggestionPanel).
- `npm test` (vitest) + tsc + lint + build must stay clean; add component tests for the queue
  row (approve/reject visibility by role+status) and the policy row (auto option disabled when
  not auto-capable) in `src/app/dashboard/__tests__/`.
