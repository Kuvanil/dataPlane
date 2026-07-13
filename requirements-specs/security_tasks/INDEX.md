# Security Admin (DP-SEC-001) — Task Index

> **Built 2026-07-13.** Source: `requirements-specs/TRD_DataPlane_Security.md` (FR1–FR9, SEC-T1–T9)
> and `requirements-specs/frontend_tasks/03_security_admin.md` (6-tab admin page breakdown).
> Scope: new backend RBAC + data-protection-policy engine (`/api/v1/roles`, `/api/v1/policies/*`,
> `/api/v1/authz/check`, `/api/v1/users/{id}/roles`) + a new `/dashboard/security` admin page,
> replacing today's read-only PII classification viewer.

## 2026-07-13 scoping note

This epic was spec'd (not built) during a session that unblocked Tenant Isolation and built out
Pipelines/Schema Intel/Visualize. Backend audit confirmed **100% greenfield**: the only RBAC
artifact in the codebase today is a flat `User.role` string column
(`backend/app/models/user.py:12`, values `admin | analyst | viewer`) consumed by the existing
`require_role()` dependency. No `Role`, `Permission`, `MaskingPolicy`, or `RowAccessPolicy` model
exists; no `roles.py` or `policies.py` router exists. The current
`frontend/src/app/dashboard/security/page.tsx` (88 lines) only renders
`GET /api/v1/schema/{id}/classify` output — it has no admin functionality and should be treated
as fully replaced, not extended.

This is roughly as much backend+frontend work as Pipelines + Schema Intel + Visualize combined
(9 backend subtasks + a 6-tab, 6-component frontend page). Per user decision, this session's
deliverable is the spec below, not implementation — same treatment Tenant Isolation got before
its ADR was resolved.

## Status legend
- `[ ]` not started · `[~]` in progress · `[x]` completed · `[!]` blocked · `[?]` needs product input

## FR coverage (landed 2026-07-13)

| FR | Requirement | Verdict |
|----|---|---|
| FR1 | Role CRUD (create/edit/deactivate) | DONE — `RoleCRUD` + `RoleList` component; built-in admin/analyst/viewer roles cannot be renamed/deactivated/deleted |
| FR2 | Assign/revoke roles for users | DONE — `UserRoleService` + `UserRoleAssignment` component; revoking a user's last role requires `?confirm=true` |
| FR3 | Role-to-permitted-module-action mapping | DONE — 10 modules × 7 actions = 70-permission static catalog, seeded on boot; `RolePermissionMatrix` component |
| FR4 | Column-level access + PII masking policies | DONE — `MaskingPolicy` model + enforcement inside `VizService.run_query` (scoped to connection_id+table_name+column_name); verified live: viewer sees `***`, exempt admin sees the real value |
| FR5 | Row-level access filters | DONE — `RowAccessPolicy` model + enforcement ANDed onto the caller's own WHERE clause in `VizService.run_query` |
| FR6 | AuthZ-check contract other modules call | DONE — `POST /api/v1/authz/check`, deny-by-default, backed by `AuthzService`'s in-process version-invalidated cache |
| FR7 | Session role/identity context surfaced | Already done pre-epic ("Admin Session" in sidebar) |
| FR8 | Privileged changes require elevated role + confirmation | DONE — every role/permission/policy mutation requires `require_role("admin")`; destructive ones (role delete, revoke-last-role) additionally require `?confirm=true`, mirroring Connectors' delete pattern |
| FR9 | Audit event on every security/policy change | DONE — `emit_audit_event` on every mutating endpoint, module="security"; surfaced live in the Audit tab |

**9 of 9 FRs done.**

## What was built (2026-07-13)

- `backend/app/models/security.py` — `Role`, `Permission`, `RolePermission`, `UserRole`,
  `MaskingPolicy`, `RowAccessPolicy`. `User.role` kept as a denormalized cache column (synced from
  a user's assigned roles, highest-privilege canonical name wins) so every existing
  `require_role()` call site across the app kept working unchanged.
- `backend/app/services/rbac_service.py` — permission catalog + default-role seeding
  (`seed_permission_catalog`, `seed_default_roles`, `backfill_user_roles`, called from
  `app.main`'s lifespan), `RoleCRUD`, `PermissionCRUD`, `UserRoleService`, `AuthzService` (the
  policy engine — in-process dict cache + a global version counter bumped on every mutating
  write, since this repo has no Redis/cache infra precedent), `MaskingPolicyCRUD` (incl.
  `apply_masking` for the 5 masking types), `RowAccessPolicyCRUD`.
- `backend/app/schemas/security.py`, routers `roles.py` / `users_admin.py` / `policies.py` /
  `authz.py`, mounted at `/api/v1/roles`, `/api/v1/users`, `/api/v1/policies`, `/api/v1/authz`.
- **Enforcement point**: `backend/app/services/viz_service.py`'s `run_query` gained a
  `requester_role` parameter — row-access policies are ANDed into the SQL WHERE clause, and
  masking policies are applied to returned dimension values post-query. Scoped to Visualize
  (which already validates connection_id + table_name identifiers) rather than Query Studio's
  arbitrary SQL, which has no structured table_name to scope a policy to — documented scope
  limit below.
- 60 new backend tests (`tests/security/`): RBAC CRUD, user-role assignment + cache sync,
  authz deny-by-default + cache invalidation, masking enforcement (all 5 types + exemption +
  no-policy passthrough), row-filter enforcement (incl. `in`/`not in`, ANDing with caller
  filters), router-level privileged-change gating + audit emission. Full backend suite:
  613/613 passing.
- Frontend: `frontend/src/app/dashboard/security/` fully rebuilt as a 6-tab admin workspace
  (Roles / Permissions / Users / Masking / Row Filters / Audit) — `hooks/useSecurity.ts`,
  `components/{RoleList,RolePermissionMatrix,UserRoleAssignment,MaskingPolicyEditor,
  RowFilterEditor,SecurityAuditLog,ConfirmDialog,Toast}.tsx`. Added `api.deleteWithResponse<T>()`
  to `frontend/src/lib/api.ts` for the two endpoints that respond 200 with a body (dependency
  warnings) instead of 204. The old read-only PII classification viewer was fully replaced (its
  functionality is superseded by the Schema Intel catalog at `/dashboard/schema`, linked from
  the new page's header).
- **Verified live in Docker**: created a real "auditor" role via the UI, toggled its permission
  matrix, assigned/revoked it on a real user, created a masking policy on `crm_users.email_address`
  (CRM_Source_Analytics) with a live "before → after" preview against real seeded email values,
  and confirmed enforcement via direct API calls with real JWTs — a `viewer` role got `***` for
  every row, an exempt `admin` got the real emails, same query. Confirmed the audit log surfaces
  the real `role_created` event with before/after. All test artifacts (test role, test masking
  policy, test viewer user) cleaned up afterward.

## Known scope limits (documented, not silent gaps)

- **Masking/row-filter enforcement is scoped to Visualize only** (`/api/v1/viz/query`), not
  Query Studio — Query Studio executes arbitrary user-authored SQL with no structured
  connection_id+table_name to scope a policy against safely. Extending enforcement there is a
  follow-up, not a silent gap.
- **Custom (non-canonical) roles don't affect the legacy `User.role` cache column** — only
  admin/analyst/viewer sync into it, since it's a precedence-ordered pick among those three.
  Custom roles still enforce correctly through `AuthzService.check`/`POST /authz/check`, just not
  through the older `require_role()` call sites scattered across other modules, which read
  `User.role` directly. Migrating those call sites to the new policy engine is out of scope here.
- **AuthzService's cache is in-process** (not Redis-backed) — correct for this single-process
  demo deployment; a multi-instance production deployment would need a shared cache with the
  same version-bump invalidation contract.

## Task list (historical — all items landed 2026-07-13)

| # | SEC-T ref | Status | Title |
|---|---|---|---|
| 01 | SEC-T1 | `[x]` | RBAC data model — `Role`, `Permission`, `RolePermission`, `UserRole` tables; migrate `User.role` string values into seed `Role` rows so `require_role()` keeps working during the transition |
| 02 | SEC-T2 | `[x]` | Policy engine + `POST /authz/check` contract — cached policy evaluation (≤50ms p95 per NFR), deny-by-default, cache invalidation on any policy write |
| 03 | SEC-T3 | `[x]` | Column/PII masking policies — `MaskingPolicy` model (connection/table/column/masking-type/role-scope) |
| 04 | SEC-T4 | `[x]` | Row-level access filters — `RowAccessPolicy` model (connection/table/filter-condition/role-scope) |
| 05 | SEC-T5 | `[x]` | Admin UI: `RoleList`, `RolePermissionMatrix`, `UserRoleAssignment` components + `/dashboard/security` tab shell |
| 06 | SEC-T6 | `[x]` | Effective-permission preview — `GET /users/{id}/effective-permissions`, folded into the Users tab rather than a 7th tab |
| 07 | SEC-T7 | `[x]` | Privileged-change gating — `require_role("admin")` + `?confirm=true` on destructive mutations |
| 08 | SEC-T8 | `[x]` | Audit emission — `emit_audit_event` on every mutating endpoint |
| 09 | SEC-T9 | `[x]` | Tests — 60 tests covering authZ bypass attempts, deny-by-default, masking/row-filter enforcement, privileged-change gating, audit |
| 10 | (frontend) | `[x]` | `MaskingPolicyEditor` + `RowFilterEditor` components |
| 11 | (frontend) | `[x]` | `SecurityAuditLog` component — reuses existing `GET /audit/events?module=security` filter |

## Confidence per task (for whoever picks this up)

- **#1 RBAC data model** — HIGH confidence, standard normalized RBAC shape (`roles`,
  `permissions`, `role_permissions`, `user_roles`). The one real design decision: whether to keep
  `User.role` as a denormalized cache column (fast `require_role()` checks without a join) or
  drop it entirely in favor of the join tables. Recommend keeping it as a cache, synced on
  `UserRole` writes — avoids a perf regression on every existing `require_role()` call site.
- **#2 Policy engine** — MEDIUM. The ≤50ms p95 NFR implies an in-memory or Redis-backed policy
  cache with invalidation on write; this repo has no existing cache layer precedent (check
  `backend/app/core/` before assuming Redis is available — may need to start with an in-process
  cache + short TTL if no cache infra exists yet).
- **#3 Masking policies** — MEDIUM, blocked in practice on Schema Intel's classification-with-
  confidence work (`schema_intel_tasks` #3/#5) landing first — masking by classification is only
  as good as the classification data underneath it.
- **#4 Row filters** — MEDIUM. Filter-condition builder (field + operator + value, AND/OR) needs
  a small expression AST, not a full query-builder — keep the operator set minimal (`=, !=, >, <,
  >=, <=, in, not in`) to avoid scope creep into general SQL.
- **#5 Admin UI shell** — HIGH once #1 exists — mechanical CRUD UI, same shape as other admin
  list/matrix pages in this repo.
- **#6 Effective-permission preview** — MEDIUM — needs #2's policy engine to already resolve
  "effective" permissions (union across a user's roles); don't reimplement resolution logic in
  the frontend.
- **#7 Privileged-change gating** — MEDIUM — needs a definition of "elevated role" (likely
  `admin` only, distinct from `analyst`) and whether "explicit confirmation" means a UI dialog,
  a re-auth step, or both. Flag as `[?]` if not resolved before implementation starts.
- **#8 Audit** — HIGH, purely wiring `record_audit` (already used everywhere else) onto new
  endpoints as they land.
- **#9 Tests** — not standalone; each task should ship tests as part of its own definition of
  done, same convention as Pipelines' Task #10.

## Execution order (recommended, once scheduled)

1. **#1 RBAC data model** — everything depends on this.
2. **#2 Policy engine + authZ contract** — needed before #3/#4 can be *enforced* (masking/filter
   *definition* CRUD doesn't strictly need #2, but *enforcement* does).
3. **#3 Masking policies** and **#4 Row filters** — can proceed in parallel once #1/#2 exist;
   confirm Schema Intel's classification work has landed before wiring masking-by-classification.
4. **#5 Admin UI shell + Role/Permission/User tabs** — needs #1.
5. **#10 Masking/Row-filter editor tabs** — needs #3, #4.
6. **#6 Effective-permission preview** — needs #2.
7. **#7 Privileged-change gating** — apply once #1/#5 exist, wrap every mutating endpoint.
8. **#8 Audit** — incremental, applied as each mutating endpoint lands, not saved for the end.
9. **#11 Security audit log tab** — no new backend, wire once #5's tab shell exists.
10. **#9 Tests** — per-task, throughout.

## Out of scope (confirmed, per TRD §2)

- Identity provider / SSO authentication mechanics — integration point, not built here.
- Secret/credential storage internals — owned by Connectors' vault integration.
- The Audit Trail viewer itself — owned by Audit Trail; Security only emits to it.
- Cross-tenant isolation — same architectural gap flagged app-wide; once
  `tenant_isolation_tasks` lands, `Role`/`Permission`/policy tables will need `tenant_id` scoping
  too (roles are almost certainly per-tenant, not global) — not re-litigated here, flagged for
  whoever builds #1.

## Progress log

- 2026-07-13 — Epic spec'd from `TRD_DataPlane_Security.md` and
  `frontend_tasks/03_security_admin.md` after a backend-readiness audit confirmed zero existing
  RBAC infrastructure. No code written. Per user decision, this session's build focus is
  Pipelines → Schema Intel → Visualize; Security Admin is deferred to a future session with its
  own task-by-task execution, same treatment Pipelines got before its 2026-07-06 build.
- 2026-07-13 (later same day) — Epic built end-to-end: full RBAC data model + policy engine +
  masking/row-filter enforcement wired into Visualize + 6-tab admin frontend, 60 new backend
  tests (613/613 total passing), verified live in Docker including real masking enforcement
  (viewer got `***`, exempt admin got real emails, same query, same data). See "What was built"
  and "Known scope limits" above for details. Built by user request immediately after Tenant
  Isolation was chosen to go second in the same batch — see `tenant_isolation_tasks/INDEX.md`
  for that epic's status.
