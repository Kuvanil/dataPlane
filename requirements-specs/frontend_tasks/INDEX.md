# Frontend — Immediate Action Items Task Index

> Source: `requirements-specs/FRONTEND_BUGS.md` (Bugs 01–06, 13).
> These 6 tasks represent the Critical/High-severity gaps that block epic delivery.
> Each task references the relevant TRD and the specific bugs it addresses.

## Task list

| # | TRD ref | Bug(s) | Title | Priority |
|---|---------|--------|-------|----------|
| [01](01_visualize_charting.md) | TRD_DataPlane_Visualize.md | Bug 01, Bug 02 | Build proper Visualize page with chart types, aggregations, filters, save/load, export | Critical |
| [02](02_schema_intel_catalog.md) | TRD_DataPlane_Schema_Intel.md | Bug 03 | Build proper Schema Intel catalog page with search, profiling, classifications, drift | High |
| [03](03_security_admin.md) | TRD_DataPlane_Security.md | Bug 04 | Build Security admin page with role CRUD, permission matrix, masking policies | High |
| [04](04_pipeline_management.md) | TRD_DataPlane_Pipelines.md | Bug 05 | Build Pipeline management page with create form, scheduler, run history, re-run | High |
| [05](05_connector_edit_delete.md) | TRD_DataPlane_Connectors.md | Bug 06 | Add edit/delete/rotate to Connectors page with dependency warnings | High |
| [06](06_tenant_isolation.md) | Multiple TRDs | Bug 13 | Create Tenant Isolation management page | High |

## Execution order (recommended)

1. **#6 Tenant Isolation** — cross-cutting concern; defines the tenant context that other pages may need to reference
2. **#2 Schema Intel Catalog** — foundational for autocomplete in Query Studio and grounding in AskData Bot
3. **#3 Security Admin** — foundational for role-gating across all other pages
4. **#4 Pipeline Management** — replaces the current visual studio with proper pipeline lifecycle
5. **#5 Connector Edit/Delete** — adds missing CRUD operations to existing page
6. **#1 Visualize Charting** — largest effort; depends on Query Studio results handoff

## Dependencies

- All tasks depend on the corresponding backend APIs being available
- Tasks #2, #3, #6 have no frontend page today — they require new routes + sidebar entries
- Tasks #1, #4, #5 modify existing pages — they require refactoring existing code
- Task #3 (Security) is a prerequisite for role-gating in all other pages