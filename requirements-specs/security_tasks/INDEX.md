# Security Admin (DP-SEC-001) — Task Index

> Source: `requirements-specs/TRD_DataPlane_Security.md` (FR1–FR9, SEC-T1–T9) and
> `requirements-specs/frontend_tasks/03_security_admin.md` (6-tab admin page breakdown).
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

## FR coverage (all NOT DONE — nothing built yet)

| FR | Requirement | Task(s) |
|----|---|---|
| FR1 | Role CRUD (create/edit/deactivate) | #1, #5 |
| FR2 | Assign/revoke roles for users | #1, #5 |
| FR3 | Role-to-permitted-module-action mapping | #1, #2, #5 |
| FR4 | Column-level access + PII masking policies | #3, #5 |
| FR5 | Row-level access filters | #4, #5 |
| FR6 | AuthZ-check contract other modules call | #2 |
| FR7 | Session role/identity context surfaced | ✅ already done ("Admin Session" in sidebar) |
| FR8 | Privileged changes require elevated role + confirmation | #6 |
| FR9 | Audit event on every security/policy change | #7 |

## Task list

| # | SEC-T ref | Status | Title |
|---|---|---|---|
| 01 | SEC-T1 | `[ ]` | RBAC data model — `Role`, `Permission`, `RolePermission`, `UserRole` tables; migrate `User.role` string values into seed `Role` rows so `require_role()` keeps working during the transition |
| 02 | SEC-T2 | `[ ]` | Policy engine + `POST /authz/check` contract — cached policy evaluation (≤50ms p95 per NFR), deny-by-default, cache invalidation on any policy write |
| 03 | SEC-T3 | `[ ]` | Column/PII masking policies — `MaskingPolicy` model (connection/table/column/masking-type/role-scope), depends on Schema Intel's classification data being queryable |
| 04 | SEC-T4 | `[ ]` | Row-level access filters — `RowAccessPolicy` model (connection/table/filter-condition/role-scope) |
| 05 | SEC-T5 | `[ ]` | Admin UI: `RoleList`, `RolePermissionMatrix`, `UserRoleAssignment` components + `/dashboard/security` tab shell |
| 06 | SEC-T6 | `[ ]` | Effective-permission preview — `GET /users/{id}/effective-permissions` + `EffectivePermissionPreview` component |
| 07 | SEC-T7 | `[ ]` | Privileged-change gating — confirmation-dialog pattern + backend re-auth/elevated-role check on role/permission/policy mutations |
| 08 | SEC-T8 | `[ ]` | Audit emission — wire `record_audit` (already used by every other module) onto every mutating endpoint from #1–#4, #6–#7 |
| 09 | SEC-T9 | `[ ]` | Tests — authZ bypass attempts, deny-by-default assertions, masking/row-filter enforcement, privileged-change gating |
| 10 | (frontend) | `[ ]` | `MaskingPolicyEditor` + `RowFilterEditor` components (depends on #3, #4) |
| 11 | (frontend) | `[ ]` | `SecurityAuditLog` component — reuses existing `GET /audit?module=security` filter, no new backend needed |

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
