# Task #9 — Tenant isolation (cross-reference, not new)

> **2026-07-09 update:** the app-wide decision this file has been waiting on is now drafted —
> see `requirements-specs/tenant_isolation_tasks/00_architecture_decision.md` (row-level
> `tenant_id` + Postgres RLS recommended, full table inventory, 5 open questions for
> Security/Product). Still **[!] blocked** on their sign-off; nothing below has changed status.

**TRD reference:** §9 Assumptions (implied — the TRD doesn't mention tenancy explicitly, but every
other epic in this codebase has hit the same gap). §12 Definition of Done — "Security sign-off on
PII handling" overlaps with this concern for the catalog/classification tables this epic creates.

**This is not a new finding.** It's already tracked in full at
`requirements-specs/mapper_tasks/07_tenant_isolation_signoff.md`, which in turn cross-references
`requirements-specs/review_schema_mapper_tasks/CONTRADICTIONS.md` item **C4**. It's restated here
only so `schema_intel_tasks/` gives a complete picture without forking the decision record into a
third place that could drift out of sync with the other two.

**Summary (see CONTRADICTIONS.md C4 for the full writeup):** no `tenant_id`/`org_id` column exists
anywhere in the schema. Every new table Task #1 introduces (`CatalogTable`, `CatalogColumn`,
`CatalogForeignKey`) and every table Tasks #2/#3/#6/#7 add (`ColumnProfile`,
`ColumnClassification`, `DriftEvent`) will inherit this gap by construction — an authenticated
user of any role could enumerate another tenant's entire schema catalog, including PII
classifications, by iterating connection or catalog-table IDs, exactly as already flagged for
`Mapping` records.

**Resolution status:** flagged to Security/Compliance, no code change without a product decision
on introducing `tenant_id` app-wide. Do not implement tenant scoping in Schema Intel's tables in
isolation — doing so only here while every other module stays unscoped would be inconsistent with
the existing gap and wouldn't actually close the exposure (a shared `DBConnection` row is still
unscoped upstream of the catalog).

**Additional Schema Intel-specific note:** this epic's catalog is arguably a *higher*-sensitivity
surface than Schema Mapper's mapping definitions, since it explicitly stores PII
classifications and (per Task #2's open question) potentially sample data. If Security/Compliance
prioritizes tenant isolation work, this epic's tables are a strong candidate to scope first once a
decision comes back — but that's a sequencing recommendation, not something to act on
unilaterally.

**Action for whoever is coordinating `schema_intel_tasks/`:** track this as a dependency/blocker
on the "Security sign-off" Definition-of-Done checkbox, alongside Task #8, not as a task to
schedule engineering work against until a decision comes back from Security/Compliance.
