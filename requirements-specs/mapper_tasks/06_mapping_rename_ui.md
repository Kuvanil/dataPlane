# Task #6 — No UI to rename a mapping

**TRD reference:** Not a named FR by number, but implied by the data model and API surface the
TRD itself specifies (§11 Technical Notes: `PUT /api/v1/mappings/{id}` — update draft) and by
FR8's general framing of drafts as editable at any time.

**Gap:** The backend fully supports renaming a mapping —
`MappingService.update_mapping_meta` (`backend/app/services/mapping_service.py:69-87`) updates
`Mapping.name`, records a `mapping_meta_updated` audit event with a proper before/after payload,
and is exposed via `PUT /api/v1/mappings/{mapping_id}` (`backend/app/api/routers/mappings.py`,
`update_mapping` handler) gated to `admin`/`analyst` roles — and it's tested
(`test_update_mapping_meta_emits_audit` in `backend/tests/mapping/test_mapping_service.py`).

Nothing in the frontend calls it. `frontend/src/app/dashboard/schema-mapper/components/
WorkspaceHeader.tsx` (lines 32-67) renders `mapping.name` as static, non-interactive text:

```tsx
<h2 className="text-base font-semibold text-zinc-100 truncate">
  {mapping.name}
</h2>
```

There's no edit affordance anywhere — not in `WorkspaceHeader`, not in `MappingList`, not in the
create-mapping modal (which only sets the name once, at creation). A fully-built, audited,
role-gated backend capability has zero UI path to reach it.

## Changes

### 1. `frontend/src/app/dashboard/schema-mapper/components/WorkspaceHeader.tsx`
- Add an inline-edit affordance next to the mapping name: a pencil icon/button visible when
  `canEdit` is true (the component already computes this, line 27), that swaps the `<h2>` for a
  text input on click, matching the visual style already used elsewhere in this module (e.g. the
  `CreateMappingModal` name input in `MappingList.tsx`).
- On blur or Enter, call a new `onRename(name: string)` prop; on Escape, revert without saving.
- Disable the edit affordance entirely when `!canEdit` (published mappings, or the current
  user's role can't edit) — same gating `WorkspaceHeader` already applies to the Publish button.

### 2. `frontend/src/app/dashboard/schema-mapper/hooks/useMapping.ts`
- Add a `rename(name: string): Promise<void>` action alongside the existing `updateTransformation`
  pattern: call `api.put<Mapping>(`/api/v1/mappings/${mapping.id}`, { name })`, update local
  `mapping` state optimistically, roll back and toast on failure — same shape as `removeEdge`'s
  existing optimistic-update-with-rollback pattern (lines 260-278), not the `enqueue`/autosave
  pattern, since a rename is a single deliberate action rather than a stream of small autosaved
  edits.
- Add `rename` to `UseMappingResult` and the hook's return object.

### 3. `frontend/src/app/dashboard/schema-mapper/page.tsx`
- Wire `onRename={m.rename}` into the `WorkspaceHeader` usage.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manual: rename a draft mapping, confirm it persists across a reload and an audit event
(`mapping_meta_updated`) appears in `/dashboard/audit`; confirm the rename affordance is absent
or disabled on a published mapping and for a `viewer` role.

## Risk

- Lowest-risk task in this set alongside #3 — pure frontend addition against an already-built,
  already-tested, already-audited backend endpoint. No backend changes needed at all.
