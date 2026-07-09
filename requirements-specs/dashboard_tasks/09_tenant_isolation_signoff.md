# Task #9 — Tenant Isolation Sign-Off (Dashboard)

> **2026-07-09 update:** the app-wide decision this file has been waiting on is now drafted —
> see `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (row-level
> `tenant_id` + Postgres RLS recommended; explicitly recommends big-bang rollout over
> incremental, addressing the "mixed isolation" risk this file flags below). Still **[!] blocked**
> on Security/Product sign-off; nothing below has changed status.

**TRD reference:** §9 Assumption (tenant isolation), §12 Definition of Done.

**Current state:** No tenant isolation exists anywhere in the codebase. This is a repo-wide gap, not specific to the Dashboard module. The Dashboard aggregation API (Task #1) queries all data without any tenant filter.

## Scope

This task is a **cross-reference only** — it does not implement tenant isolation for the Dashboard. It documents the dependency and blocks the Dashboard's DoD until the app-wide decision is made.

### Cross-reference to existing sign-off tasks

The same gap has been identified and documented in every other module:

| Module | Task | Status |
|--------|------|--------|
| Schema Mapper | `mapper_tasks/07_tenant_isolation_signoff.md` | [!] blocked |
| Schema Intel | `schema_intel_tasks/09_tenant_isolation_signoff.md` | [!] blocked |
| Connectors | `connector_tasks/10_tenant_isolation_signoff.md` | [!] blocked |
| Pipelines | `Pipelines_tasks/11_secret_vaulting_signoff.md` (related) | [!] blocked |
| **Dashboard** | **This file** | **[!] blocked** |

### What tenant isolation means for the Dashboard

If/when tenant isolation is implemented app-wide, the Dashboard aggregation API would need to:

1. **Accept a `tenant_id` context** — either from the authenticated user's profile (if users are tenant-scoped) or from a request header.
2. **Filter all module queries by `tenant_id`** — every `db.query(...)` in `dashboard_service.py` would need a `.filter(Model.tenant_id == current_tenant_id)` clause.
3. **Cache key includes `tenant_id`** — the caching layer (Task #2) already uses `user_id` in the cache key; `tenant_id` would be added to prevent cross-tenant cache leaks.

### Impact on Dashboard architecture

The Dashboard is a read-only aggregation layer. It does not own any data — it reads from other modules' tables. Therefore:

- **No schema changes needed in the Dashboard module itself.** The Dashboard has no tables of its own.
- **The Dashboard is purely a consumer of tenant isolation.** Once other modules add `tenant_id` filtering to their models, the Dashboard's queries automatically respect tenant boundaries (assuming the queries are updated to include the filter).
- **The caching layer is the main risk.** Without tenant-aware cache keys, one tenant's dashboard data could be served to another tenant. The cache key must include `tenant_id`.

### Decision needed

Before the Dashboard can be marked "done" per the TRD's DoD, a product/architect decision is needed on:

1. **Tenant model:** Is each user scoped to a single tenant (SaaS model), or can a user access multiple tenants?
2. **Tenant ID source:** From the JWT token, a request header, or the user's profile in the database?
3. **Implementation order:** Will tenant isolation be added to all modules simultaneously (preferred), or incrementally per module?

Until this decision is made, the Dashboard aggregation API operates without tenant isolation — all data is visible to all authenticated users. This is acceptable for a single-tenant dev deployment but must be addressed before production.

## Dependencies

- App-wide tenant isolation decision (blocked on product/architect sign-off)
- All other modules' tenant isolation implementations (Dashboard consumes their data)

## Edge cases

- **Mixed isolation:** If some modules implement tenant isolation before others, the Dashboard's data will be partially filtered. A connector from tenant A might appear alongside a pipeline from tenant B. Mitigation: Dashboard should not be marked "done" until all source modules have tenant isolation.
- **Cache cross-tenant leak:** Without `tenant_id` in the cache key, a request from tenant A could receive tenant B's cached data. Mitigation: The cache key already includes `user_id`; adding `tenant_id` is a one-line change once the tenant model is decided.

## Verify

N/A — this is a sign-off task, not an implementation task. Verification is a manual review of the tenant isolation implementation across all modules.

## Risk

High (deferred). The absence of tenant isolation is a security and compliance risk for multi-tenant deployments. For the current single-tenant dev deployment, the risk is acceptable. This task exists to ensure the gap is not forgotten when moving to production.