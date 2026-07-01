# Schema Mapper Frontend Upgrade — Design

> **Scope:** Upgrade `frontend/src/app/dashboard/schema-mapper/page.tsx` to consume the new `/api/v1/mappings` surface delivered in commits `f10caac`–`a70da86`. Adds mapping list, draft persistence, AI accept/reject, transformation editor, validation, publish/versioning, and export UI. Role-aware.

> **Out of scope:** New shared component library, new design system, charting/graph library for the canvas (keep the existing inline-SVG approach), backend changes, prompts alignment.

---

## 1. Goal

Replace the stateless fallback-driven `page.tsx` with a real workspace that:
- Lists existing mappings and lets the user open or create one.
- Renders the visual canvas backed by the live `/api/v1/mappings/{id}` endpoint.
- Lets the user add/remove field edges (drag-to-connect → API call).
- Surfaces AI suggestions from the Celery task and lets the user accept/reject.
- Lets the user edit a per-edge transformation through a typed editor.
- Validates on demand, displays blocking errors inline, and blocks Publish until they're resolved.
- Saves the draft automatically (30 s + on blur) and explicitly.
- Publishes a new immutable version and lets the user select older versions.
- Exports the published artifact as JSON for the Pipelines team.

## 2. Non-Goals

- No new top-level routes; everything stays under `/dashboard/schema-mapper`.
- No Zustand/Redux; React local state + a thin custom hook (`useMapping`) is enough.
- No new dependencies beyond what's already in `package.json` (next, react, tailwind).
- No changes to other dashboard pages.
- No design-system overhaul; reuse the existing zinc/blue/emerald palette already used in `layout.tsx`.

## 3. Component Tree

```
SchemaMapperPage
├── MappingList              (left rail — list + Create button)
├── MappingWorkspace          (right pane when a mapping is selected)
│   ├── WorkspaceHeader       (mapping name, status, version selector, role-aware buttons)
│   ├── DraftBar              (autosave indicator, last-saved timestamp, manual Save)
│   ├── Canvas                (drag-to-connect visual; shows source/target columns + edges)
│   │   ├── SourcePanel       (left)
│   │   ├── ConnectorOverlay  (inline SVG between panels)
│   │   └── TargetPanel       (right)
│   ├── SuggestionPanel       (pending AI suggestions with Accept / Reject / confidence)
│   ├── EdgeInspector         (when an edge is selected: shows transformation, edit/delete)
│   ├── TransformEditor       (modal — typed editor for one of the 11 transformation kinds)
│   ├── ValidationPanel       (validate button + issue list; surfaces blocking errors)
│   ├── PublishDialog         (confirm publish + show blocking count + version label)
│   └── ExportModal           (version picker + download button + JSON preview)
└── EmptyState                (when no mapping is selected)
```

## 4. State Model

A single `useMapping(mappingId)` hook owns the state for one open mapping. It exposes:

```ts
type MappingState = {
  mapping: Mapping | null;
  edges: FieldMapping[];
  suggestions: AISuggestion[];
  selectedEdgeId: number | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  validation: ValidationResponse | null;
  exportVersionId: number | null;
  role: "admin" | "analyst" | "viewer";
};
```

Actions (all thin wrappers around `api.post` / `api.put` / `api.delete`):
- `load(mappingId)` — GET mapping + GET suggestions
- `create(sourceId, targetId, name)` — POST `/mappings`
- `addEdge(target, sources, transformation)` — POST `/mappings/{id}/edges`
- `removeEdge(edgeId)` — DELETE
- `updateTransformation(edgeId, transformation)` — PUT
- `requestSuggestions()` — POST `/suggestions` (returns task_id; poll `/tasks/{id}` for completion; refetch suggestions on SUCCESS)
- `acceptSuggestion(suggestionId, transformation)` — POST accept
- `rejectSuggestion(suggestionId)` — POST reject
- `validate()` — POST validate, returns verdict
- `publish()` — POST publish
- `export(versionId?)` — GET export

`dirty` flips true on any local-only mutation that hasn't been persisted. Autosave fires on a 30 s timer and on `unmount` / `visibilitychange === 'hidden'`. The backend already persists on every action; "draft autosave" here means: any local-only edits (e.g. a transformation written into the TransformEditor modal before the user clicks "Apply") get flushed.

## 5. User Flows

### F1 — Open existing mapping
1. Page loads → `GET /mappings` populates MappingList.
2. User clicks a row → `GET /mappings/{id}` + `GET /suggestions`.
3. Canvas + SuggestionPanel render.

### F2 — Create draft
1. Click "New Mapping".
2. Modal asks for name, source connection, target connection.
3. `POST /mappings` → redirect to that mapping.

### F3 — Add edge (drag-to-connect)
1. User drags source column onto target column.
2. Optimistic: edge appears immediately with `transformation={kind:"direct"}`.
3. `POST /mappings/{id}/edges`.
4. On failure, roll back and surface error toast.

### F4 — AI suggestions
1. User clicks "Get AI Suggestions".
2. `POST /suggestions` returns task_id.
3. Show "Generating suggestions…" banner; poll `/tasks/{task_id}` every 2 s.
4. On SUCCESS, `GET /suggestions` and show in SuggestionPanel sorted by confidence desc.
5. Each row: Accept / Reject buttons. Accept pre-fills the TransformEditor with `{kind:"direct"}` so the user can adjust before applying; Reject dismisses.

### F5 — Edit transformation
1. User selects an edge → EdgeInspector shows current transformation.
2. Click "Edit" → TransformEditor modal opens.
3. Editor is type-aware: dropdown for `kind`, dynamic fields per kind (validated client-side against the same grammar).
4. Apply → `PUT .../edges/{id}/transformation` → edge updates.

### F6 — Validate
1. Click "Validate".
2. `POST /validate` → render issue list grouped by verdict.
3. Blocking issues: red badge on Publish button; Publish disabled.
4. Warning issues: amber badge; Publish still enabled with confirm.

### F7 — Publish
1. Click "Publish".
2. PublishDialog shows: current blocking count, target version label (next = current+1).
3. Confirm → `POST /publish` → on success, toast + refresh; status pill flips to "Published v3".

### F8 — Version selector
1. After publish, the WorkspaceHeader version selector becomes enabled.
2. Lists all versions (oldest → newest). Default = latest.
3. Selecting an older version calls `GET /export?version_id=N` and renders in ExportModal preview.
4. Edits on a non-latest version are disabled (immutability guarantee).

### F9 — Export
1. Click "Export" → ExportModal opens.
2. Shows version selector (defaults to current published).
3. "Download JSON" triggers `Blob([JSON.stringify(artifact, null, 2)])` save.
4. "Copy" copies the JSON to clipboard.

## 6. Role Gating in UI

`role` is fetched once via `GET /api/v1/auth/me` on page mount and cached in `useMapping`. If the call fails (no token), redirect to `/login`. UI behavior:

| Action | viewer | analyst | admin |
|---|---|---|---|
| View mapping | ✅ | ✅ | ✅ |
| Add/remove edge | hidden | ✅ | ✅ |
| Edit transformation | hidden | ✅ | ✅ |
| Request AI suggestions | hidden | ✅ | ✅ |
| Accept/reject suggestion | hidden | ✅ | ✅ |
| Validate | ✅ (read-only) | ✅ | ✅ |
| Publish | hidden | hidden | ✅ |
| Delete | hidden | hidden | ✅ |
| Export | ✅ | ✅ | ✅ |

Disabled buttons get a tooltip explaining the required role.

## 7. Autosave

- `dirty=true` after any local mutation (edge added locally, transformation typed but not yet PUT).
- A 30 s `setInterval` in `useMapping` calls `flushDirty()` when dirty.
- `flushDirty()` issues the queued PUTs in order.
- `visibilitychange === 'hidden'` and `beforeunload` also trigger flush.
- DraftBar shows "Saving…", "Saved 12s ago", or "Unsaved changes" status.

## 8. Error Handling

- Every API call wrapped in try/catch; `ApiError` → toast (top-right, auto-dismiss 5 s) with `err.message`.
- 401 → clear localStorage token and redirect to `/login`.
- 403 on a disabled action → button stays disabled with tooltip; if somehow hit, toast "Insufficient role".
- 409 on publish/delete of a non-draft mapping → toast "This mapping is no longer a draft".
- 422 with `detail.kind === 'grammar_error'` → open TransformEditor with the offending field highlighted.
- 422 with `detail.kind === 'validation_blocking'` → open ValidationPanel with the issue list.

## 9. Accessibility

- All buttons have `aria-label`; the canvas connector overlay exposes `role="img"` with an `aria-label` describing the edge.
- Drag-to-connect has a keyboard fallback: arrow keys move the selection between source/target columns, Enter connects.
- Color is never the sole signal: edges have line style (solid for manual, dashed for AI) plus a confidence label.
- Modal dialogs trap focus and are dismissable with Escape.
- Color choices respect the existing palette and pass WCAG 2.1 AA against zinc-950.

## 10. Files to Create / Modify

**New:**
- `frontend/src/app/dashboard/schema-mapper/page.tsx` — rewrite
- `frontend/src/app/dashboard/schema-mapper/components/MappingList.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/WorkspaceHeader.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/DraftBar.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/SuggestionPanel.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/EdgeInspector.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/TransformEditor.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/ValidationPanel.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/PublishDialog.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/ExportModal.tsx`
- `frontend/src/app/dashboard/schema-mapper/components/Toast.tsx`
- `frontend/src/app/dashboard/schema-mapper/hooks/useMapping.ts`
- `frontend/src/app/dashboard/schema-mapper/lib/transformations.ts` — client-side grammar validator + payload shapes (mirrors the backend `TransformationGrammar`)
- `frontend/src/app/dashboard/schema-mapper/lib/types.ts` — TS types matching backend Pydantic schemas
- `frontend/src/app/dashboard/schema-mapper/lib/format.ts` — small formatting helpers (confidence %, timestamp)

**Modified:** none outside `dashboard/schema-mapper/`. The page's path stays the same so the sidebar link keeps working.

## 11. Acceptance Criteria

- [ ] MappingList renders all existing mappings from `GET /mappings`.
- [ ] Clicking a row opens the Workspace with mapping + suggestions loaded.
- [ ] "New Mapping" creates a draft via `POST /mappings` and opens it.
- [ ] Drag source → target creates an edge via `POST .../edges`; appears immediately (optimistic).
- [ ] Clicking an edge opens the EdgeInspector with its transformation.
- [ ] Edit Transformation opens TransformEditor; saving calls `PUT .../transformation`.
- [ ] "Get AI Suggestions" enqueues a Celery task; the UI polls `/tasks/{id}` and renders suggestions on completion.
- [ ] Accept/Reject on a suggestion updates the backend and the UI.
- [ ] Validate button shows issue list with blocking/warning/ok counts.
- [ ] Publish button is disabled when blocking_count > 0; on success, status flips to "Published v{N}".
- [ ] Version selector lists all versions; selecting one opens ExportModal with that version's JSON.
- [ ] Autosave fires after 30 s of dirty state and on tab hide.
- [ ] Viewer role hides all edit buttons; analyst hides Publish/Delete; admin sees all.
- [ ] Next.js production build (`npm run build`) passes with zero TypeScript errors.
- [ ] No new dependencies added.
- [ ] Existing demo seed data (CRM_Source_Analytics, Data_Warehouse_Target) makes the visual canvas renderable end-to-end against the seeded SQLite databases.

## 12. Risks

- **Large schemas**: rendering 1,000 columns in DOM is expensive. Mitigation: virtualize the SourcePanel/TargetPanel lists using a simple windowing approach (only render visible rows based on scroll position). Out of MVP if performance is acceptable for the seed data (≤ 20 columns per table).
- **Polling load**: 2 s polling on `/tasks/{id}` is fine for the demo; for production consider websockets or server-sent events (deferred).
- **Optimistic edge rollback**: if `POST .../edges` fails after optimistic insert, the UI must remove the edge. Handled in the `addEdge` action.
