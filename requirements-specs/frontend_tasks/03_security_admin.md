# Task #3 — Build Security Admin Page

**TRD reference:** `TRD_DataPlane_Security.md` (FR1–FR9)
**Bug(s):** Bug 04 (High)
**Priority:** High

## Current State

The `/dashboard/security` page displays a hardcoded PII classification table from `GET /api/v1/schema/1/classify`. It has no security administration functionality.

**What exists:**
- PII classification table for connection ID 1
- "Run Audit Scan" button (non-functional)
- DAMA metadata display (data owner, steward, retention)

**What does NOT exist:**
- Role CRUD (FR1): create, edit, deactivate roles
- User role assignment/revocation (FR2)
- Role-to-permission mapping matrix (FR3)
- Column-level access and PII masking policy editor (FR4)
- Row-level access filter editor (FR5)
- Effective-permission preview (implied by checklist)
- Privileged-change gating UI (FR8)
- Audit event display for security changes (FR9)

## Scope

### 1. Rebuild `/dashboard/security` as a full admin page

The page should have multiple tabs/sections for different security administration functions.

### 2. Components to build

#### `RoleList` — Role management
- List of all roles with name, description, user count
- Create new role button → inline form or modal
- Edit role (name, description)
- Deactivate/activate role toggle
- Delete role (with dependency check — cannot delete if users assigned)
- Loading state: skeleton list
- Empty state: "No roles defined — create your first role"
- Error state: error message with retry

#### `RolePermissionMatrix` — Role-to-permission mapping
- Table/matrix with roles as rows and module actions as columns
- Checkbox per cell to grant/revoke permission
- Module actions: view, edit, create, delete, run, publish, admin
- Modules: Connectors, Pipelines, Schema Mapper, Schema Intel, Query Studio, AskData Bot, AI Autopilot, Audit Trail, Security
- Select all / deselect all per row
- Save button with confirmation
- Unsaved changes warning on navigation

#### `UserRoleAssignment` — User role management
- User search/autocomplete
- Current roles for selected user displayed as badges
- Add role dropdown
- Remove role button per badge
- Save changes button
- Loading state while fetching user data
- Empty state: "No users found"

#### `MaskingPolicyEditor` — Column-level masking
- Connection/table/column selector to pick target
- Masking type selector: redact, hash, truncate, substitute, nullify
- Role selector: which roles see masked vs unmasked
- Preview: show sample data before and after masking
- Save policy button
- List of existing masking policies with edit/delete
- Loading/empty/error states

#### `RowFilterEditor` — Row-level access
- Connection/table selector
- Filter condition builder: field + operator + value
- Role selector: which roles this filter applies to
- Multiple filter conditions with AND/OR logic
- Preview: show row count before and after filter
- Save/delete existing filters

#### `EffectivePermissionPreview` — Permission preview
- User selector
- Shows effective permissions across all modules
- Shows which permissions come from which role
- Shows denied-by-default gaps
- Loading state while computing

#### `SecurityAuditLog` — Security change audit
- Filterable list of security-related audit events
- Columns: timestamp, actor, action, target, before/after summary
- Link to full Audit Trail for details
- Loading/empty/error states

### 3. Tab layout

```
┌─────────────────────────────────────────────────────┐
│ [Roles] [Permissions] [Users] [Masking] [Row Filters] [Audit] │
├─────────────────────────────────────────────────────┤
│                                                       │
│  (Active tab content)                                  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 4. Data flow

```
Roles tab → GET /api/v1/roles → RoleList
           → POST /api/v1/roles → create
           → PUT /api/v1/roles/{id} → update
           → DELETE /api/v1/roles/{id} → deactivate

Permissions tab → GET /api/v1/roles → list with permissions
                → PUT /api/v1/roles/{id} → update permissions

Users tab → GET /api/v1/users → list
          → POST /api/v1/users/{id}/roles → assign
          → DELETE /api/v1/users/{id}/roles/{roleId} → revoke

Masking tab → GET /api/v1/policies/masking → list
            → PUT /api/v1/policies/masking → create/update
            → DELETE /api/v1/policies/masking/{id} → delete

Row Filters tab → GET /api/v1/policies/row-access → list
                → PUT /api/v1/policies/row-access → create/update
                → DELETE /api/v1/policies/row-access/{id} → delete

Preview tab → GET /api/v1/users/{id}/effective-permissions → preview

Audit tab → GET /api/v1/audit?module=security → events
```

## Dependencies

- Backend: All Security API endpoints (SEC-T1 through SEC-T8)
- Backend: User management API (may exist from IdP integration)
- Backend: Audit Trail API for security audit log
- Frontend: Tab/navigation component pattern (reuse from existing pages)

## Edge Cases

- **No roles defined:** Show empty state with "Create your first role" CTA
- **Cannot delete role with users:** Show warning with list of assigned users
- **Permission conflicts:** If a user has two roles with conflicting permissions, show which role grants which permission
- **Unsaved changes:** Warn before navigating away from Permission Matrix with unsaved changes
- **Privileged operations:** Role CRUD and permission changes require elevated role + confirmation dialog
- **Masking policy conflicts:** If a column has multiple masking policies, show conflict warning
- **Row filter performance:** Preview should show row count estimate, not full data scan
- **Audit log large volume:** Paginate audit log; default to last 7 days

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- Role CRUD works (create, edit, deactivate, delete with dependency check)
- Permission matrix saves and reflects correctly
- User role assignment works
- Masking policy creates, displays, and deletes
- Row filter creates, displays, and deletes
- Effective permission preview shows correct permissions
- Security audit log displays events
- Privileged operations require confirmation
- All tabs have loading/empty/error states

## Risk

High. This is the largest new page with 6 tabs and many components. Key risks:
1. Backend Security API may not exist yet — this is entirely backend-dependent
2. User management API depends on IdP integration which may not be complete
3. Permission model must be defined before the matrix UI can be built
4. Masking and row filter policies require Schema Intel classifications to be available
5. Privileged-change gating requires session/role context to be reliable