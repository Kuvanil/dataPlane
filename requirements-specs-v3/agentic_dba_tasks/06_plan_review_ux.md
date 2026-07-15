# Task #6 — Plan-card review UX in Query Workspace

**Reference:** TRD §5 FR4; INDEX.md design decisions #2 (no execution without approval), #9
(async, pollable generation), #10 (stateful/editable across turns). Depends on #3/#4/#5.

**Goal:** Render a `SchemaDesignPlan` in the Ask-mode chat as a structured, reviewable artifact —
not prose — with explicit per-artifact approve/edit/reject actions. Analogous precedent already in
this codebase: Autopilot's approval-queue UI and Query Studio's `WriteConfirmModal`.

## Changes

### 1. New API surface (backend, small — mostly task #3's service exposed over HTTP)
- `GET /api/v1/agentic-dba/plans/{id}` — plan status + content (for polling while `status:
  "generating"`).
- `POST /api/v1/agentic-dba/plans/{id}/approve` — records approval, triggers task #7's execution.
- `POST /api/v1/agentic-dba/plans/{id}/reject` — records rejection, no execution.
- (Edit-in-place is a stretch goal for this task — even a "reject and re-ask with a refined
  question" loop, relying on decision #10's session-context statefulness, is an acceptable first
  cut; full inline editing of individual proposed tables/columns can be a fast-follow.)

### 2. New frontend component: `query-workspace/components/SchemaDesignPlanCard.tsx`
- Rendered inside `AskDataView`'s `ChatBubble` (or a sibling component) when a chat turn's response
  is a plan reference rather than a normal answer — poll `GET .../plans/{id}` while `status:
  "generating"` (mirrors existing polling patterns already used elsewhere in the frontend, e.g.
  Autopilot's run console, if one exists — check before inventing a new polling hook).
- Sections: **Proposed tables** (name + columns + types, collapsible per table), **Data quality
  rules** (each with its profiling-based justification and confidence, per task #4), **Transforms**
  (per target column, per task #5), **Generated DDL** (collapsible raw SQL, dialect-aware per
  decision #8).
- Actions: **Approve & Create** (calls the approve endpoint), **Reject** (calls reject), both
  disabled while `status: "generating"`. Approving should feel like the existing
  `WriteConfirmModal` in weight/seriousness — this creates real schema objects.

### 3. Tests
- Component test rendering a fixture plan in each status, asserting the approve/reject actions
  fire the right calls and are disabled appropriately during generation.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
cd frontend && npx vitest run
```
Manually: exercise the full generating → ready → approve/reject flow against a real backend plan.

## Risk

- Coordinate the polling contract's exact `status` values and cadence with task #3's async design
  before finalizing — don't guess at semantics only to have to rework both sides.
- This card is doing more visual/informational work than any existing chat-embedded component in
  this codebase — budget real design iteration, not just a functional first pass, given how
  consequential an "Approve & Create" click is.
