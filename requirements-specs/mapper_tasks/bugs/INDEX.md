# Schema Mapper — Bug Validation Report

> Validated against `TRD_DataPlane_Schema_Mapper.md` (FR1–FR8, AC1–AC3) and implementation code as of commit `d2ea82b`.
> Status: 107/107 backend tests passing. 6 of 7 TRD-gap tasks done (#1, #3, #5, #6); 1 open (#2 keyboard a11y), 1 blocked (#7 tenant isolation).

## Bug Summary

| # | Area | Severity | Status | Title |
|---|------|----------|--------|-------|
| 01 | Canvas UI | **HIGH** | Fixed | N:1 mapping creation unreachable in Canvas UI (backend guard + frontend multi-select added) |
| 02 | Canvas UI | **HIGH** | [?] Open | Drag-and-drop edge creation has no keyboard alternative (WCAG 2.1 AA) |
| 03 | Schema Panel | **MEDIUM** | Fixed | Nullability not displayed in schema panels |
| 04 | Canvas UI | **MEDIUM** | [?] Open | Canvas has no virtualization/search for large schemas |
| 05 | Canvas UI | **MEDIUM** | Fixed | Unsaved transformation edits silently lost on session timeout |
| 06 | Workspace | **LOW** | Fixed | No UI to rename a mapping |
| 07 | Cross-cutting | **HIGH** | [!] Blocked | Tenant isolation — deferred |

## Post-Completion Review Findings (2026-07-06 architect review)

| # | Area | Severity | Status | Title |
|---|------|----------|--------|-------|
| 08 | `Canvas.tsx` | **HIGH** | Fixed | Nullability silently dropped on edge create — `onDrop`/`connectStagedSources` never forwarded `nullable` |
| 09 | `useMapping.ts` | **MEDIUM** | Fixed | Autosave silently dropped queued edits on partial failure — queue splice discarded unexecuted ops |
| 10 | `page.tsx` | **LOW** | Fixed | Session-expiry warning lost on redirect — `dp_session_expired_with_pending` flag never read |
| 11 | Backend | **MEDIUM** | Fixed | Two uncoordinated edge-creation paths could double-map a target — drag-and-drop vs staged multi-select |
| 12 | Canvas | **LOW** | Fixed | Auto-generated concat had no separator and no review step |
| 13 | Backend | **LOW** | Fixed | Concat parts-count under-consumption unvalidated — `_sql_concat` only rejected too MANY parts |
| 14 | `useMapping.ts` | **LOW** | Fixed | `rename`/`removeEdge` rollback used stale closure — concurrent edge change silently discarded |
| 15 | `MappingList.tsx` | **LOW** | Fixed | Sidebar didn't reflect a rename — `MappingList` had no subscription |
| 16 | `Canvas.tsx` | **LOW** | Fixed | `window.getSelection()` was wrong drag-detection signal — replaced with `justDraggedRef` |

## FR Coverage Verification

| FR | Requirement | Status |
|----|------------|--------|
| FR1 | Visual mapping canvas showing source/target schemas | ✅ Done |
| FR2 | Drag-and-drop edge creation, N:1 via staged multi-select | ✅ Done |
| FR3 | Transformation editor (concat, direct, custom SQL) | ✅ Done |
| FR4 | Field-level mapping validation (type compatibility, nullability) | ✅ Done |
| FR5 | AI suggestions for unresolved fields | ✅ Done |
| FR6 | Publish mapping as a versioned contract | ✅ Done |
| FR7 | Reject field removal from published mapping | ✅ Done |
| FR8 | Rename mapping | ✅ Done |
| AC1 | Create N:1 mapping | ✅ Done |
| AC2 | Transform editor shows transformation SQL | ✅ Done |
| AC3 | Publish creates versioned snapshot | ✅ Done |