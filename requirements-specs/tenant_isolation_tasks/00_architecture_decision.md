# ADR — App-Wide Tenant Isolation Model

**Status:** Accepted (2026-07-13) — Option A (row-level `tenant_id` + Postgres RLS), signed off
answers to all 5 open questions in §8. **No code implements this yet.** A same-day build attempt
was aborted after design work revealed the real scope is a multi-session effort (stale table
inventory, a non-superuser DB role requirement for RLS, SQLite-vs-Postgres testability, and a
Celery tenant-context gap) — see §9 for findings and §10 for a proposed phased execution order.
[INDEX.md](INDEX.md) still holds the original (now superseded-in-scope) task breakdown.

**Supersedes (content-wise; those files now just point here):**
`review_schema_mapper_tasks/CONTRADICTIONS.md` C4 (2026-07-03, the original finding) →
`mapper_tasks/07_tenant_isolation_signoff.md` →
`schema_intel_tasks/09_tenant_isolation_signoff.md` →
`connector_tasks/10_tenant_isolation_signoff.md` →
`dashboard_tasks/09_tenant_isolation_signoff.md` →
`ai_autopilot_tasks/11_security_signoff.md` (tenant-isolation portion).

Six files across six epics have now independently flagged this same gap and each said,
correctly, "don't implement in isolation, wait for an app-wide decision." None of them proposed
a model — they were waiting for this document. Per their own stated principle (don't fork the
decision record into an Nth place), this is the *one* place with substantive content; the six
files above are being updated to point here rather than restate the finding a seventh time.

## 1. Problem statement (grounded in current code, 2026-07-09)

There is no tenant/organization concept anywhere in the product:

- `User` ([backend/app/models/user.py](../../backend/app/models/user.py)) has no org/tenant FK —
  just `email`, `hashed_password`, `role`.
- The JWT ([auth_service.py](../../backend/app/services/auth_service.py)) carries only `sub`
  (email) and `role`. There is no tenant claim to even carry.
- Every query in every service (`ConnectionService`, `MappingService`, `PipelineService`,
  `AutopilotService`, schema catalog, dashboard aggregation, audit log, chat sessions, query
  history) reads/writes globally. Any authenticated user of any role can enumerate any other
  "tenant's" data by iterating IDs — mappings, connections (including redacted-but-present
  connector metadata), pipelines, PII classifications, audit trails, autopilot policies.
- One pre-existing artifact: `Pipeline.tenant_id` ([pipeline.py:28-30](../../backend/app/models/pipeline.py#L28-L30))
  is a nullable `String` column added speculatively, with a comment pointing back to this exact
  decision. It was never backed by a real `tenants` table and is unenforced everywhere. This ADR
  treats it as a placeholder to be replaced, not a precedent to extend.
- No migration tool exists (`Base.metadata.create_all` only — see root `CLAUDE.md`/`SKILLS.md`).
  Any schema change here needs a documented manual migration, same as the connectors epic's
  `ALTER TABLE` note.

**Full table inventory (2026-07-09), for scoping the eventual build:**

| Root entities (would need their own `tenant_id`) | Child entities (reachable only via a scoped parent FK) |
|---|---|
| `users`, `connections`, `mappings`, `pipelines`, `chat_messages`, `query_history`, `audit_log`, `autopilot_runs`, `autopilot_policies`, `autopilot_recommendations` | `mapping_versions`, `field_mappings`, `ai_suggestions`, `schedules`, `retry_policies`, `pipeline_runs`, `pipeline_run_steps`, `drift_events`, `catalog_tables`, `catalog_columns`, `catalog_foreign_keys`, `schema_snapshots`, `autopilot_logs`, `autopilot_action_logs` |

11 root tables, 13 child tables. Every root table is queried directly by at least one router
today with no ownership check beyond `get_current_user`/`require_role`.

## 2. Options considered

### A — Row-level `tenant_id` + Postgres Row-Level Security (RLS) — **recommended**

Add a `tenants` table and a `tenant_id` FK to every root table (children inherit scope
transitively via their parent FK, but see §4 on whether to denormalize anyway). A FastAPI
dependency resolves the current tenant from the JWT and both (a) filters every query at the
application layer and (b) sets a Postgres session variable (`SET app.tenant_id = ...`) that RLS
policies on each table enforce independently of the application code.

- **Fit:** smallest structural change to this codebase — one dependency pattern
  (`require_tenant`) mirroring the existing `require_role` pattern, one column per root table,
  no change to connection pooling or session management.
- **Risk:** row-level isolation is only as strong as "every query is scoped." A missed
  `.filter()` is a cross-tenant leak. This is exactly why RLS is not optional in this proposal —
  it's the backstop for the mistake application code will eventually make. Without RLS, this
  option is meaningfully weaker and I would not recommend it alone.
- **Cost:** RLS policy per table (11 policies to start), a session-scoped `SET` on every request
  (needs a `get_db`-level hook, since `SessionLocal()` is currently a plain per-call session
  factory with no request-scoped hook point today), and a policy-bypass path for background
  Celery tasks that legitimately operate cross-tenant (e.g. `check_schema_drift_task` iterating
  all connections) — those need an explicit superuser/service-role bypass, audited.

### B — Schema-per-tenant (one Postgres schema per tenant, same tables replicated)

Stronger structural isolation (a bug can't leak across a `search_path` boundary as easily as a
missed WHERE clause). Rejected for this codebase specifically: `create_all`-only schema
management (no Alembic) would need to run once per tenant schema instead of once — multiplying
the exact pain point this repo already flags as a manual-migration risk. Cross-tenant reporting
(if ever wanted — e.g. an internal ops view) becomes a fan-out query across N schemas instead of
one filtered query. No connection-pooling/session-context precedent exists in this codebase for
per-request `search_path` switching; that's new infrastructure, not a fit for the existing
`SessionLocal` pattern.

### C — Database-per-tenant

Strongest isolation, heaviest operationally: provisioning a new DB per signup, N-way connection
routing, N-way migrations, backup/restore per tenant. This is the right answer *if* the actual
deployment target has a contractual or regulatory requirement for physical data separation per
customer — which is a fact only Product/Security knows, not something to infer from the code.
Flagged as **Open Question 2** below rather than assumed away.

## 3. Recommendation

**Option A** (row-level `tenant_id` + RLS), conditional on Open Question 2's answer not being
"yes, we need physical DB separation" — if it is, this ADR's data-model sketch still tells you
which tables need scoping, but the isolation *mechanism* would need to change to B or C.

## 4. Data model sketch (for the eventual build — not implemented)

- New `tenants` table: `id` (PK), `name`, `created_at`. Minimal on purpose — expand only when a
  real requirement shows up (billing, plan tier, etc. are not this ADR's concern).
- `tenant_id` (Integer, FK → `tenants.id`) added to all 11 root tables listed in §1.
  - Start `nullable=True` for the migration window (matching the existing `Pipeline` precedent's
    *intent*, if not its type — `Pipeline.tenant_id` should be retyped from `String` to the real
    FK once a `tenants` table exists, not left as an orphaned string column).
  - Backfill every existing row to a single "default" legacy tenant (one INSERT + one UPDATE per
    table), then flip to `nullable=False` once backfilled — same shape as the connectors epic's
    documented manual `ALTER TABLE` migration.
- Child tables: **denormalize `tenant_id` onto them too**, even though it's reachable via their
  parent FK. Reason: RLS policies are simplest and fastest when every table can filter on its
  own column rather than joining up to a parent for every policy check; the small storage/write
  cost is worth the policy simplicity and defense-in-depth (a child row with a `tenant_id` that
  doesn't match its parent's is itself a detectable integrity error).
- `users` gets `tenant_id` too — **Open Question 1** below is whether this is 1:1 (simple FK) or
  many:many (join table), which changes this row's shape.

## 5. Auth / request-scoping sketch

- JWT gains a `tenant_id` claim, set at login from the user's `tenant_id` (or, if Open Question 1
  resolves to multi-tenant-per-user, from whichever tenant the user selected at login/switch).
- New `require_tenant()` FastAPI dependency (same shape as `app/api/deps.py`'s `require_role`)
  resolves `tenant_id` from the decoded token and is threaded into `get_db` (or a wrapping
  dependency) to run `SET app.tenant_id = :tid` on the checked-out connection before the request
  handler runs.
- Service methods add `.filter(Model.tenant_id == tenant_id)` — a full sweep across every
  service, not optional even with RLS (defense-in-depth, and RLS alone would still let a
  cross-tenant `INSERT` reference another tenant's FK'd row unless FK targets are also checked).
- Celery tasks that intentionally operate across all tenants (drift-check sweep, health-check
  sweep, autopilot evaluate sweep) need an explicit bypass path, clearly named
  (`_run_as_platform_service`), not a silent absence of scoping.

## 6. Open questions for Security/Product (blocking — not mine to decide)

1. **Tenant cardinality per user.** Does a user belong to exactly one tenant (simple FK on
   `users.tenant_id`), or can one person work across multiple orgs (needs a join table +
   tenant-switcher UI)? This changes the data model in §4 and the login/JWT flow in §5.
2. **Physical isolation requirement.** Is there a contractual/regulatory reason (a specific
   customer's data-residency clause, a compliance certification) that requires DB- or
   schema-level physical separation rather than row-level + RLS? If yes, re-open §2's decision
   between A/B/C.
3. **Platform-level cross-tenant access.** Does an internal ops/support role need to see across
   tenants (e.g. to debug a customer issue)? If yes, that's a *named, audited* bypass — not a
   loophole in the RLS policies, and every use of it should itself emit an audit event.
4. **Rollout sequencing.** Big-bang (every table scoped in one release) vs. incremental
   (module-by-module, accepting `dashboard_tasks/09`'s already-flagged "mixed isolation" risk —
   tenant A's connector could appear next to tenant B's pipeline on a dashboard mid-rollout)?
   **Recommendation: big-bang** — the mixed-isolation window is itself a leak, and this
   codebase's tables are small enough in number (24 total) that a coordinated migration is
   feasible in one pass, unlike a codebase with hundreds of tables.
5. **Legacy-tenant assignment.** For the backfill (§4), is there real production data yet that
   needs assigning to a real customer/tenant, or is everything in the current dev/demo Postgres
   disposable (in which case the backfill step simplifies to "drop and reseed")?

## 7. What happens next

Once Security/Product answer §6: file `INDEX.md` in this directory (already drafted, task
breakdown ready) as an active epic, same treatment as AI Autopilot — spec reviewed, then built
task-by-task with tests. Until then, this ADR is the artifact the six prior cross-reference files
should point to; no engineering work is scheduled against it.

## 8. Answers to §6 open questions (2026-07-13)

1. **Tenant cardinality per user.** One tenant per user — simple FK on `users.tenant_id`
   (`nullable=True` during migration, `NOT NULL` after backfill). No join table, no
   tenant-switcher UI. This resolves Task #09 in `INDEX.md` to a no-op: the frontend needs the
   tenant name surfaced in session context (e.g. sidebar/header), not a switcher.
2. **Physical isolation requirement.** No contractual/regulatory requirement exists today.
   Confirms Option A (row-level `tenant_id` + RLS) as final — §2's Option B/C are rejected, not
   just deferred.
3. **Platform-level cross-tenant access.** No internal ops/support role needs cross-tenant
   access. Task #07's Celery bypass is scoped *only* to the existing background sweep tasks
   (`check_schema_drift_task`, health-check sweep, autopilot evaluate sweep) that legitimately
   iterate all tenants for platform maintenance — not to any human-facing role. No
   `platform_admin`-style bypass role is being added.
4. **Rollout sequencing.** Big-bang — all 11 root tables + 13 child tables scoped in one
   coordinated release, per the ADR's own recommendation in §6.4.
5. **Legacy-tenant assignment.** Current Postgres data is disposable dev/demo data. Task #02's
   backfill simplifies to: create one "default" tenant row, then either backfill all existing
   rows to it or drop and reseed — implementer's choice, since there's no real customer data to
   preserve.

## 9. Scoping findings from an aborted build attempt (2026-07-13)

An attempt to execute `INDEX.md`'s task list surfaced that the real engineering scope is
substantially larger than this ADR (written 2026-07-09) and `INDEX.md` estimated. No code was
written — these are findings from design work only, recorded here so the next session doesn't
rediscover them from scratch.

**9.1 The table inventory in §1 is stale.** It lists 11 root + 13 child = 24 tables. As of
2026-07-13 the codebase has **39 tables** — Security Admin (`roles`, `permissions`,
`role_permissions`, `user_roles`, `masking_policies`, `row_access_policies`), Visualize
(`viz_views`), Semantic (`semantic_entities`/`dimensions`/`measures`/`metric_definitions`/
`lineage`), Schema Intel (`column_profiles`, `column_classifications`), and Query Studio
(`saved_queries`) all landed after this ADR was drafted. The root/child/global classification in
§4 extends mechanically to these (root = owned directly by a tenant; child = reachable via a
parent FK, denormalize per §4's existing reasoning; `permissions` is the one **global** table —
it's a static module×action catalog, not tenant data) — re-deriving the model isn't the blocker,
re-doing the *volume* of column/policy/service work for 39 tables instead of 24 is.

**9.2 Genuine RLS enforcement requires a non-superuser Postgres role.** This repo's `api`/
`worker`/`beat` containers all connect as the `postgres` superuser
(`docker-compose.yml`'s `DATABASE_URL`). Postgres superusers unconditionally bypass RLS — no
`FORCE ROW LEVEL SECURITY` setting or policy configuration overrides this. Making §2 Option A's
RLS backstop real (not decorative) requires: a new non-superuser role (e.g. `dataplane_app`)
created at boot, a second SQLAlchemy engine bound to it for the request-scoped runtime path,
keeping the existing superuser engine for DDL (`create_all`) and a small set of legitimately
tenant-agnostic "system" operations (boot-time seeding, login's pre-tenant-resolution user
lookup, Celery's cross-tenant sweep tasks per §5), and a `get_db()` rework that decodes the
request's JWT and issues `SET app.tenant_id` on the runtime connection before the request
handler runs.

**9.3 The app-layer filter is the primary, portable mechanism — RLS is Postgres-only backstop
on top of it, not a shortcut around it.** This repo's entire test suite (613 tests as of
2026-07-13) runs against in-memory SQLite, which has no RLS support at all. A GUC-driven
`server_default` (`current_setting('app.tenant_id')`) on the `tenant_id` column would work on
Postgres but silently fail on SQLite, making the isolation logic itself untestable in the
existing test harness. The correct, testable design threads `tenant_id` as an explicit parameter
through every service's create/list/get methods (set from the resolved tenant on the Python
side, not a DB-side default) — this is real, per-service-file work, not the "RLS makes the
app-layer filter optional" shortcut that seemed available before this was worked through.

**9.4 Celery tasks currently carry zero tenant context.** Every existing Celery task (pipeline
runs, schema drift checks, autopilot evaluation, audit buffer flush) is invoked with plain
business-object IDs (`run_pipeline_task.delay(pipeline_id, run_id)`) — none thread a tenant_id
through. §5's "bypass path for 3 named sweep tasks" undersold this: making even the
*non-sweep* tasks (e.g. `run_pipeline_task`) tenant-aware requires changing every task's
signature *and* every call site that enqueues it (routers), not just adding a bypass to the 3
tasks that are supposed to run cross-tenant.

**9.5 Net effect on scope.** Full, correctly-enforced, tested tenant isolation across all 39
tables — with Celery tasks made tenant-aware and a Postgres-backed cross-tenant leak test suite
(the existing SQLite test harness can't exercise RLS at all) — is a multi-day, multi-session
build, not a same-day epic like Pipelines/Schema Intel/Visualize/Security Admin were. Per user
decision on 2026-07-13, this epic is being left at ADR-accepted-but-unscheduled rather than
starting a partial build; **§10 below proposes a phased execution order** for whoever picks this
up next, so the scope is visible before committing to a start date.

## 10. Proposed phased execution order (not started; for a dedicated future session)

Rather than one big-bang session, split delivery into independently-shippable phases so partial
progress is never "half-isolated" in a way that's worse than not-isolated (the mixed-isolation
risk §6.4 already flagged, now scoped to phases instead of tables):

1. **Phase 1 — Core 5**: `users`, `connections`, `mappings`, `pipelines`, `audit_log` (the tables
   every prior cross-reference doc named as the concrete leak risk) + their child tables. Tenant
   model, JWT claim, `dataplane_app` role + RLS, service-layer filter threading, a real
   Postgres-backed cross-tenant leak test for just these 5. Ships as a complete, independently
   correct slice — not "5 of 39 done," but "the highest-risk tables are now actually isolated."
2. **Phase 2 — Remaining root tables**: `chat_messages`, `query_history`, `autopilot_*` (3
   tables), `saved_queries`, `viz_views`, `roles`, `user_roles`, `masking_policies`,
   `row_access_policies`, `semantic_entities`. Same pattern as Phase 1, mechanically repeated.
3. **Phase 3 — Celery tenant-awareness**: thread `tenant_id` through every task signature and
   enqueue call site; retire the "Celery runs unscoped" carve-out from Phase 1/2 down to only the
   3 legitimately-cross-tenant sweep tasks §5 originally intended.
4. **Phase 4 — Admin surface + cross-reference cleanup**: Task #12's tenant management page,
   Task #11's status updates across the 6 prior cross-reference files.

Each phase should land with its own tests and its own live-Docker leak-check before starting the
next — don't let "isolation" be claimed for a table before its filter+RLS+test are all in place.
