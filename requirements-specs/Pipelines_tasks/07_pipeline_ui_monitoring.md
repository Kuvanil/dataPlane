# Task #7 — Pipeline UI + monitoring (PIPE-T7)

**TRD reference:** FR1, FR3, FR4, FR6, Usability NFR ("clear run timeline/status, actionable
error messages").

**Current state:** `frontend/src/app/dashboard/pipelines/page.tsx` exists as a single page with
no `components/` subdirectory. It implements the pre-TRD "Visual Transformation Studio": a
React-Flow canvas with hardcoded source/ai_matcher/mask/target nodes, a connection picker,
an "Execute Pipeline" button posting to `/api/v1/pipelines/execute`, and an ephemeral results
panel. There is no pipeline list, no create form referencing a *published mapping* (it only
wires raw DB connections), no schedule editor, and no persisted run history/monitor view.

## Scope

Rewrite to match the Schema Mapper frontend's established pattern (list + workspace + side
panels — see `frontend/src/app/dashboard/schema-mapper/`):

- `frontend/src/app/dashboard/pipelines/page.tsx` — top-level layout: pipeline list + selected
  pipeline workspace.
- `frontend/src/app/dashboard/pipelines/components/PipelineList.tsx` — list view with
  create/enable/disable/delete actions (role-gated per Task #8 — hide/disable mutating actions
  for unauthorized roles rather than only relying on the backend 403, matching the Schema Mapper
  UI's existing pattern).
- `.../components/CreateForm.tsx` — source connection picker, target connection picker,
  *published mapping* picker (list mappings via existing `GET /mappings` filtered to published
  versions — this replaces the current page's raw-connections-only flow, closing the FR1 gap).
- `.../components/ScheduleEditor.tsx` — cron string input (with human-readable preview, e.g.
  "every day at 2:00 AM") + enable/disable toggle, calling Task #4's
  `PUT /pipelines/{id}/schedule`.
- `.../components/RunMonitor.tsx` — live status view for a run: overall status, per-step
  (extract/transform/load) status from `PipelineRunStep`, row counts, duration, and on failure
  the `error_message` surfaced prominently (Usability NFR: "actionable error messages" — don't
  just show a raw stack trace/exception string). Poll `GET /pipelines/{id}/runs/{run_id}`
  (Task #6) at an interval consistent with the "monitoring updates within 5s" NFR.
- `.../components/RunHistory.tsx` — list of past runs with a "Re-run" action per row calling
  `POST /runs/{id}/rerun` (Task #6).

## Dependencies

- Task #1 (CRUD API), Task #4 (schedule API), Task #6 (run history/re-run API), Task #8 (role
  gating — the UI needs to know the current user's role to hide unauthorized actions).

## Verify

- Manual QA via `npm run dev`: create a pipeline from a published mapping, schedule it, trigger a
  manual run, watch the monitor update, view history, re-run a past run.
- `cd frontend && npx tsc --noEmit && npm run build` must stay green.
- No frontend component test harness exists yet for this module (same gap noted for Schema
  Mapper's Canvas in `mapper_tasks/01_n_to_one_ui.md`) — this is a pre-existing gap, not new to
  Pipelines; call out but don't block on it unless a harness is added project-wide.

## Risk

Medium — this is the largest single UI rewrite in this directory (replacing a whole page's
interaction model, not adding to an existing one). Recommend confirming the create-form UX
(mapping picker placement, schedule editor affordance) with a quick design check before or during
implementation, similar to how Schema Mapper's N:1 UX needed a judgment call
(`mapper_tasks/01_n_to_one_ui.md`).
