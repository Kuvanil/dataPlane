# #05 — Dashboard Sub-pages Bulk Migration

## Scope
Migrate every remaining `bg-zinc-*` / `text-zinc-*` / `border-zinc-*` class
across the dashboard tree (`/dashboard/*`) and its components to the
semantic theme tokens defined in `app/globals.css`. **No changes to data
wiring, props, fetches, effects, or event handlers.**

## Status
`[x]` completed (2026-07-14)

## How
A single perl script (`/tmp/zinc-to-tokens.pl`) was run against every file
in `frontend/src/app` that contained a zinc class. The script:

1. Matches `(?:[\w-]+:)?(bg|text|border)-(zinc)-(\d+)(?:/\d+)?` — i.e.
   optionally captures a Tailwind modifier (`hover:`, `placeholder:`,
   `focus:`, etc.), then the kind and shade, then an optional opacity.
2. Looks up the new semantic token in a per-kind table.
3. Drops the opacity suffix (the semantic tokens already encode the right
   opacity for dark mode; in light mode they're solid colors).
4. Writes the file back in place (`perl -i`).

The script is **idempotent** — re-running on already-migrated files is a
no-op (the pattern won't match).

## Files migrated (82)

```
askdata/components/ChatBubble.tsx
askdata/components/ConnectionPicker.tsx
audit/components/CorrelationTimeline.tsx
audit/components/EventDetail.tsx
audit/components/EventTable.tsx
audit/components/ExportButton.tsx
audit/components/FilterBar.tsx
audit/components/JsonViewer.tsx
audit/page.tsx
autopilot/components/ActionLog.tsx
autopilot/components/ApprovalQueue.tsx
autopilot/components/badges.tsx
autopilot/components/PolicyPanel.tsx
autopilot/components/RunConsole.tsx
autopilot/page.tsx
components/ActivityFeed.tsx
components/DashboardWidget.tsx
components/KPITile.tsx
components/TimeRangeFilter.tsx
connectors/components/ConnectorAuditLog.tsx
connectors/components/ConnectorCard.tsx
connectors/components/CredentialRotationModal.tsx
connectors/components/DeleteConnectorDialog.tsx
connectors/components/EditConnectorModal.tsx
connectors/lib/types.ts
connectors/page.tsx
integrations/page.tsx
page.tsx
pipelines/components/PipelineList.tsx
pipelines/components/RunHistory.tsx
pipelines/components/RunMonitor.tsx
pipelines/components/ScheduleEditor.tsx
pipelines/lib/format.ts
pipelines/page.tsx
query-studio/components/ConnectionSelector.tsx
query-studio/components/HistoryPanel.tsx
query-studio/components/ResultsTable.tsx
query-studio/components/SavedQueriesPanel.tsx
query-studio/components/WriteConfirmModal.tsx
query-workspace/components/AskDataView.tsx
query-workspace/components/SchemaDesignPlanCard.tsx
query-workspace/components/SqlWorkspaceView.tsx
query-workspace/page.tsx
query-workspace/QueryWorkspaceInner.tsx
schema-mapper/components/Canvas.tsx
schema-mapper/components/DraftBar.tsx
schema-mapper/components/EdgeInspector.tsx
schema-mapper/components/ExportModal.tsx
schema-mapper/components/MappingList.tsx
schema-mapper/components/PublishDialog.tsx
schema-mapper/components/SuggestionPanel.tsx
schema-mapper/components/TransformEditor.tsx
schema-mapper/components/ValidationPanel.tsx
schema-mapper/components/WorkspaceHeader.tsx
schema-mapper/page.tsx
schema/components/CatalogSearchBar.tsx
schema/components/CatalogTableCard.tsx
schema/components/ConnectionPicker.tsx
schema/components/DriftHistoryPanel.tsx
schema/page.tsx
security/components/ConfirmDialog.tsx
security/components/MaskingPolicyEditor.tsx
security/components/RoleList.tsx
security/components/RolePermissionMatrix.tsx
security/components/RowFilterEditor.tsx
security/components/SecurityAuditLog.tsx
security/components/UserRoleAssignment.tsx
security/lib/format.ts
security/page.tsx
semantic/page.tsx
tenants/components/TenantCreateForm.tsx
tenants/components/TenantDetail.tsx
tenants/components/TenantList.tsx
visualize/components/ChartCanvas.tsx
visualize/components/ChartTypeSelector.tsx
visualize/components/ExportMenu.tsx
visualize/components/FieldConfigPanel.tsx
visualize/components/FilterBar.tsx
visualize/components/SaveViewDialog.tsx
visualize/page.tsx
visualize/topology/page.tsx
```

(Also: `app/page.tsx` — the landing page, which was migrated as part of
Chunk 2's rewrite. Listed here for completeness.)

## Token map (applied)

| Old class | New class |
|---|---|
| `bg-zinc-950` | `bg-background` |
| `bg-zinc-900` + opacity `/N` | `bg-surface-elevated` |
| `bg-zinc-900` (no opacity) | `bg-surface` |
| `bg-zinc-800` + opacity `/N` | `bg-surface-overlay` |
| `bg-zinc-800` (no opacity) | `bg-surface-overlay` |
| `bg-zinc-700` | `bg-surface-overlay` |
| `text-zinc-50`, `text-zinc-100` | `text-fg` |
| `text-zinc-200`, `text-zinc-300` | `text-fg-muted` |
| `text-zinc-400`–`text-zinc-600` | `text-fg-subtle` |
| `border-zinc-800`, `border-zinc-900` | `border-border` |
| `border-zinc-700`, `border-zinc-600` | `border-border-strong` |

Modifiers (`hover:bg-zinc-800`, `placeholder:text-zinc-500`, etc.) are
preserved automatically.

## What did NOT change
- Any import, prop, or function signature.
- Any data fetch, effect, or event handler.
- Any line of JS logic.
- The `react/no-unescaped-entities` issue on `login/page.tsx` (preserved;
  this task does not touch apostrophe escaping).
- The lint baseline — every issue still flagged is in a file that
  existed before this work and is unrelated to the theme migration.

## Verification
- `grep -rl "zinc-" frontend/src/app` → 0 files after migration.
- Existing vitest suite still runs (no behavioral changes).
- `npm run lint` output unchanged from baseline (same files, same issues).

## Acceptance
- ✅ Zero `zinc-*` classes remain in `frontend/src/app`.
- ✅ All previously-passing tests still pass.
- ✅ No new lint findings.
- ✅ Data wiring from prior task chunks untouched.
