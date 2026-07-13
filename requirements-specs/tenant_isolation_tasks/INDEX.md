# Tenant Isolation — Task Index (app-wide)

> **Re-scoped, not started** — ADR signed off 2026-07-13 (Option A: row-level `tenant_id` +
> Postgres RLS, one tenant per user, no cross-tenant ops bypass, big-bang rollout, disposable
> legacy data — see [00_architecture_decision.md §8](00_architecture_decision.md)). A same-day
> build attempt was aborted after design work showed the task list below undersizes the real
> scope by roughly 3-4x — see [00_architecture_decision.md §9](00_architecture_decision.md) for
> why (39 tables now, not 24; RLS needs a non-superuser DB role; the app-layer filter, not RLS,
> is the only mechanism testable against this repo's SQLite test suite; Celery tasks have zero
> tenant-context plumbing today). **Use [§10's phased plan](00_architecture_decision.md) instead
> of the task table below when picking this up** — the table is kept for reference but reflects
> the original, now-superseded scope estimate.

## Status legend
- `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked · `[?]` needs product input

## Priority order (in dependency order — this IS the execution order)

| # | Title | Status | Depends on |
|---|---|---|---|
| 01 | `tenants` table + `tenant_id` on all 11 root tables (nullable, migration-safe) | `[ ]` | — |
| 02 | Backfill: create one "default" tenant, backfill or reseed (data is disposable per ADR §8.5); flip `tenant_id` to `NOT NULL` | `[ ]` | 01 |
| 03 | JWT `tenant_id` claim + login flow update | `[ ]` | 01 |
| 04 | `require_tenant()` dependency + request-scoped `SET app.tenant_id` on `get_db` | `[ ]` | 03 |
| 05 | Postgres RLS policies on all 11 root tables (+ 13 child tables per ADR §4) | `[ ]` | 01, 04 |
| 06 | Service-layer sweep: `.filter(tenant_id=...)` on every query in every service | `[ ]` | 04 |
| 07 | Celery cross-tenant sweep tasks get an explicit, named, audited bypass — scoped ONLY to `check_schema_drift_task`/health-check sweep/autopilot evaluate sweep per ADR §8.3, no human-facing bypass role | `[ ]` | 05, 06 |
| 08 | Retype `Pipeline.tenant_id` from placeholder `String` to the real FK | `[ ]` | 01 |
| 09 | Frontend: surface tenant name in session context (sidebar/header) — no switcher UI needed, resolved to 1:1 per ADR §8.1 | `[ ]` | 03 |
| 10 | Dedicated cross-tenant-leak test suite — for every root+child table, assert tenant A cannot read/write/list tenant B's rows via any exposed endpoint | `[ ]` | 01–07 |
| 11 | Update all 6 prior cross-reference files' status from "blocked" to "done" once live | `[ ]` | all above |
| 12 | Admin tenant management page (list/create/view tenant, resource usage) using the already-scaffolded `frontend/src/app/dashboard/tenants/components/{TenantList,TenantDetail,TenantCreateForm}.tsx` — needs a matching `tenants.py` router (`GET/POST /api/v1/tenants`, `GET /api/v1/tenants/{id}`, `GET /api/v1/tenants/{id}/users`, `GET /api/v1/tenants/{id}/resources`) and `page.tsx` entry point | `[ ]` | 01, 03 |

## Confidence per task (once unblocked)

- **#01–#04** — HIGH confidence, mechanical once the ADR's open questions are answered (the
  answers determine exact shape — 1:1 vs many:many on `users`, primarily — but the pattern
  itself is standard).
- **#05 RLS** — MEDIUM. Correct RLS policy syntax is well-documented, but this repo has zero
  precedent for session-scoped Postgres variables through SQLAlchemy's connection pool — the
  `get_db`/session-checkout hook needs care to avoid leaking one request's tenant context into a
  pooled connection reused by the next request.
- **#06 service sweep** — HIGH confidence but LARGE surface (every service file). Should be
  built with #10's leak-test suite from the start, not after — a missed filter is exactly the
  kind of thing you want a red test to catch during the sweep, not in production.
- **#07 Celery bypass** — MEDIUM. Needs a clear naming/audit convention decided once, then
  applied consistently; the risk is scope creep where "just this one task also needs to skip
  scoping" quietly becomes the norm.
- **#09 frontend** — depends entirely on ADR Q1; could be a no-op (if 1:1) or a real UI feature
  (if multi-tenant-per-user).
- **#10 leak-test suite** — HIGH confidence, this is the safety-net pattern already used for
  AI Autopilot's guardrails (`tests/autopilot/test_safety_guardrails.py`) — same shape, applied
  to tenant boundaries instead of action guardrails.

## Progress log

- 2026-07-09 — ADR drafted (`00_architecture_decision.md`) consolidating six prior
  cross-reference files' findings into one substantive proposal: row-level `tenant_id` + Postgres
  RLS recommended, full table inventory (11 root + 13 child), data model + auth sketch, 5 open
  questions for Security/Product. This INDEX drafted alongside it. No code changed — per user
  decision, this session's deliverable is the decision + spec, not implementation.
- 2026-07-13 — ADR signed off: Option A confirmed, 1:1 tenant-per-user, no cross-tenant ops
  bypass, big-bang rollout, legacy data disposable. Epic unblocked from `[!]` to active. Added
  Task #12 to reconcile the already-scaffolded `frontend/src/app/dashboard/tenants/` components
  (built ahead of this ADR, calling endpoints that don't exist yet) with the now-final data model.
  No implementation started yet in this session — Tasks #01-#12 remain `[ ]`; this session's
  build focus is Pipelines → Schema Intel → Visualize per separate agreement with the user.
- 2026-07-13 (later same day) — After Security Admin was built, a build attempt on this epic was
  started and aborted at the design stage (no code written) once it became clear the task list
  above undersizes the real scope substantially: the table inventory is stale (39 tables now vs.
  the 24 this list assumes), genuine RLS enforcement needs a new non-superuser Postgres role
  (superusers unconditionally bypass RLS), the app-layer filter — not RLS — is the only
  mechanism this repo's SQLite-based test suite can actually exercise, and Celery tasks have no
  tenant-context plumbing at all today (not just the 3 sweep tasks this list's Task #07
  anticipated). Full findings + a phased re-plan are in
  `00_architecture_decision.md` §9–§10. Re-scoped as a dedicated multi-session epic per user
  decision, rather than starting a partial build in this session.
