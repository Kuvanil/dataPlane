# Task #6 — Create Tenant Isolation Management Page

**TRD reference:** Referenced in multiple TRDs as a cross-cutting concern
**Bug(s):** Bug 13 (High)
**Priority:** High

## Current State

There is no frontend page for tenant isolation management. Multiple TRDs reference tenant isolation as a requirement:
- Connectors TRD: "Mapping definitions are tenant-scoped and isolated"
- Pipelines TRD: "Tenant isolation in execution"
- Dashboard TRD: "Per-tenant cache"
- Security TRD: "Tenant isolation in policy enforcement"

**What exists:**
- No tenant isolation page
- No tenant selector in the sidebar or header
- No tenant context indicator in the UI
- The sidebar shows "Admin Session" but no tenant information

**What does NOT exist:**
- Tenant management UI (list, create, edit tenants)
- Tenant context switcher (if multi-tenant admin)
- Tenant isolation boundaries visualization
- Per-tenant resource counts and limits
- Tenant-level audit view

## Scope

### 1. Create new Tenant Isolation page at `/dashboard/tenants`

This page is for platform administrators to manage tenants and view tenant isolation boundaries.

### 2. Components to build

#### `TenantList` — Tenant management
- Table: tenant name, ID, status (active/suspended), created date, resource counts
- Create new tenant button → inline form or modal
- Edit tenant (name, status)
- Suspend/activate tenant toggle
- Resource counts per tenant: connections, mappings, pipelines, users
- Loading state: skeleton table
- Empty state: "No tenants configured"
- Error state: error message with retry

#### `TenantCreateForm` — Create tenant
- Tenant name (required)
- Tenant slug/identifier (auto-generated from name, editable)
- Initial admin user email (optional)
- Resource limits (optional): max connections, max mappings, max pipelines
- Create button → `POST /api/v1/tenants`
- Cancel button
- Validation: name required, slug must be unique
- Loading state during creation
- Error state on creation failure

#### `TenantDetail` — Tenant detail view
- Header: tenant name, status badge, created date
- Tabs: Overview, Resources, Users, Audit

#### `TenantOverview` — Tenant overview tab
- Resource usage cards: connections (X/Y used), mappings (X/Y used), pipelines (X/Y used)
- Recent activity feed for this tenant
- Status indicator (active/suspended)
- Quick actions: suspend, edit limits

#### `TenantResourceList` — Per-tenant resources
- Tabbed view: Connections, Mappings, Pipelines
- Each tab shows resources belonging to this tenant
- Click to navigate to the resource's management page
- Loading/empty/error states per tab

#### `TenantUserList` — Per-tenant users
- List of users assigned to this tenant
- Columns: name, email, role, last active, status
- Add user to tenant button
- Remove user from tenant button (with confirmation)
- Loading/empty/error states

#### `TenantAuditLog` — Per-tenant audit events
- Filterable list of audit events for this tenant
- Columns: timestamp, actor, action, target, module
- Link to full Audit Trail for details
- Loading/empty/error states

#### `TenantContextIndicator` — Current tenant display (add to sidebar/header)
- Show current tenant name in the sidebar or header
- If user has access to multiple tenants, show a tenant switcher dropdown
- Tenant context colors (optional: color-code UI per tenant)
- "All Tenants" view for super-admins

### 3. Sidebar update

Add "Tenants" to the sidebar navigation (admin-only visibility):
```tsx
{ role === "admin" && (
  <Link href="/dashboard/tenants" ...>
    <span>🏢</span> Tenants
  </Link>
)}
```

### 4. Data flow

```
Tenant list → GET /api/v1/tenants → TenantList
            → POST /api/v1/tenants → create
            → PUT /api/v1/tenants/{id} → update
            → DELETE /api/v1/tenants/{id} → suspend

Tenant detail → GET /api/v1/tenants/{id} → TenantDetail
              → GET /api/v1/tenants/{id}/resources → resource counts
              → GET /api/v1/tenants/{id}/users → user list
              → GET /api/v1/audit?tenant_id={id} → audit events

Tenant context → GET /api/v1/auth/me → current tenant
               → GET /api/v1/tenants → available tenants (for switcher)
```

### 5. Route changes

| Route | Purpose |
|-------|---------|
| `/dashboard/tenants` | Tenant list (admin only) |
| `/dashboard/tenants/new` | Create new tenant |
| `/dashboard/tenants/{id}` | Tenant detail view |
| `/dashboard/tenants/{id}/settings` | Tenant settings/limits |

## Dependencies

- Backend: Tenant CRUD API
- Backend: Tenant resource listing API
- Backend: Auth/me endpoint must return tenant context
- Backend: All other APIs must support tenant_id filtering
- Frontend: Role-based sidebar visibility (admin vs non-admin)

## Edge Cases

- **Non-admin user accesses /dashboard/tenants:** Show 403 or redirect to dashboard
- **Single tenant deployment:** Hide tenant management entirely (most common case)
- **Tenant suspension:** Suspended tenant should show "Suspended" banner on all pages
- **Tenant deletion:** Soft-delete with resource cleanup warning
- **Resource limit reached:** Show warning when creating resources in a tenant at its limit
- **Cross-tenant data leakage:** UI should never show resources from another tenant
- **Tenant switcher:** Switching tenants should refresh all data for the new tenant context
- **Super-admin view:** "All Tenants" view shows aggregate data across all tenants
- **Tenant with no resources:** Show empty states per resource tab
- **Tenant with many users (>100):** Paginate user list

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- Tenant list loads and displays tenants
- Create tenant form validates and creates
- Tenant detail shows overview with resource counts
- Resource tabs show per-tenant resources
- User list shows tenant users
- Audit log shows tenant-scoped events
- Non-admin users cannot access tenant pages
- Tenant context indicator shows in sidebar
- Tenant switcher works (if multi-tenant)
- All components have loading/empty/error states

## Risk

Medium. This is a new page with cross-cutting implications. Key risks:
1. Backend tenant APIs may not exist at all — this is entirely backend-dependent
2. Tenant isolation is a cross-cutting concern — all other pages must respect tenant context
3. The tenant model (single-tenant vs multi-tenant) must be decided before building
4. Adding tenant context to the sidebar/header affects the entire app layout
5. Resource limits require backend enforcement, not just UI display
6. Super-admin "All Tenants" view requires all APIs to support cross-tenant queries