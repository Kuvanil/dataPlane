# Tenant Isolation — Task Index (app-wide)

> **[!] Entire epic blocked** on Security/Product answering the open questions in
> [00_architecture_decision.md](00_architecture_decision.md). Nothing below is scheduled work —
> it's the breakdown ready to execute once that ADR is signed off, so sign-off isn't followed by
> a second planning pass. Same treatment as every blocked cross-cutting decision in this repo
> (mapper #07, schema_intel #09/#11, connector #10, dashboard #09, autopilot #11) — those six
> files now point here instead of restating the gap.

## Status legend
- `[ ]` not started · `[!]` blocked (this entire epic, pending the ADR)

## Priority order (in dependency order — this IS the execution order once unblocked)

| # | Title | Depends on |
|---|---|---|
| 01 | `tenants` table + `tenant_id` on all 11 root tables (nullable, migration-safe) | ADR §6 answered |
| 02 | Backfill existing rows to a legacy/default tenant; flip `tenant_id` to `NOT NULL` | 01 |
| 03 | JWT `tenant_id` claim + login flow update | 01 |
| 04 | `require_tenant()` dependency + request-scoped `SET app.tenant_id` on `get_db` | 03 |
| 05 | Postgres RLS policies on all 11 root tables (+ 13 child tables per ADR §4) | 01, 04 |
| 06 | Service-layer sweep: `.filter(tenant_id=...)` on every query in every service | 04 |
| 07 | Celery cross-tenant sweep tasks get an explicit, named, audited bypass | 05, 06 |
| 08 | Retype `Pipeline.tenant_id` from placeholder `String` to the real FK | 01 |
| 09 | Frontend: tenant context in the session; tenant-switcher UI IF ADR Q1 answered multi-tenant-per-user | 03 |
| 10 | Dedicated cross-tenant-leak test suite — for every root+child table, assert tenant A cannot read/write/list tenant B's rows via any exposed endpoint | 01–07 |
| 11 | Update all 6 prior cross-reference files' status from "blocked" to "done" once live | all above |

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
