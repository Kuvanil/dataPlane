# Task #10 — Tenant isolation (cross-reference, not new)

> **2026-07-09 update:** the app-wide decision this file has been waiting on is now drafted —
> see `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (row-level
> `tenant_id` + Postgres RLS recommended; explicitly addresses `DBConnection`'s upstream role and
> the `Pipeline.tenant_id` placeholder column). Still **[!] blocked** on Security/Product
> sign-off; nothing below has changed status.

**TRD reference:** §9 Assumptions (implied — not mentioned explicitly, but every other epic in
this codebase has hit the same gap). §12 Definition of Done overlaps with this for `DBConnection`,
the most upstream table in the whole schema.

**This is not a new finding.** It's already tracked in full at
`requirements-specs/mapper_tasks/07_tenant_isolation_signoff.md`, which cross-references
`requirements-specs/review_schema_mapper_tasks/CONTRADICTIONS.md` item **C4**, and restated again
at `requirements-specs/schema_intel_tasks/09_tenant_isolation_signoff.md`. It's restated here only
so `connector_tasks/` gives a complete picture without forking the decision record into a fourth
place that could drift out of sync with the other three.

**Summary (see CONTRADICTIONS.md C4 for the full writeup):** no `tenant_id`/`org_id` column exists
anywhere in the schema in an enforced way. `backend/app/models/pipeline.py` (built independently)
added a `tenant_id` column to `Pipeline`, but deliberately left it nullable and unenforced with an
explicit comment pointing back to this decision — *"Nullable until app-wide tenant_id lands
(mapper_tasks #7). When added, set nullable=False and add a WHERE filter to every query."*
`connector_tasks/01_connection_data_model.md`'s original draft proposed adding `tenant_id` to
`DBConnection` without that same caution; it's now gated pending this decision (see that file).

**Why `DBConnection` matters more than most tables for this decision:** it's the single most
upstream, most shared table in the schema — `Mapping`, `Pipeline`, `CatalogTable`, and
`SchemaSnapshot` all FK into it. Whatever tenant-isolation approach gets decided will need to
reach `DBConnection` regardless of which module implements it first, since every other module's
tenant scoping is only as good as the connection records underneath being scoped correctly too.

**Resolution status:** flagged to Security/Compliance, no code change without a product decision
on introducing `tenant_id` app-wide. Do not implement tenant scoping on `DBConnection` in
isolation — see `connector_tasks/01_connection_data_model.md`'s gated `tenant_id` row for the two
options once a decision comes back (drop entirely for now, or add as an inert nullable column
matching `Pipeline`'s precedent).

**Action for whoever is coordinating `connector_tasks/`:** track this as a dependency/blocker on
the "Security sign-off" Definition-of-Done checkbox, alongside Task #2's sign-off gate, not as a
task to schedule engineering work against until a decision comes back from Security/Compliance.
