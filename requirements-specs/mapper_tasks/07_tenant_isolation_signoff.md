# Task #7 — Tenant isolation + Security/Compliance sign-off (cross-reference, not new)

**TRD reference:** §9 Assumptions — "Mapping definitions are tenant-scoped and isolated." §12
Definition of Done — "Security/compliance sign-off for regulated-environment constraints."

**This is not a new finding.** It's already tracked in full at
`requirements-specs/review_schema_mapper_tasks/CONTRADICTIONS.md`, item **C4**, and listed as
item **#9** in `requirements-specs/review_schema_mapper_tasks/INDEX.md`. It's restated here only
so this directory (`mapper_tasks/`) gives a complete picture of every open TRD item in one place,
without forking the decision record into two places that could drift out of sync.

**Summary (see CONTRADICTIONS.md C4 for the full writeup):** no `tenant_id`/`org_id` column
exists anywhere in the schema (`Mapping`, `DBConnection`, `User` are all unscoped). `list_mappings`
/`get_mapping` gate only on authentication, not ownership — any authenticated user of any role can
read any other user's mapping definitions by iterating mapping IDs. This is a whole-app
architectural gap, not something introduced by or fixable within the Schema Mapper module alone.

**Resolution status:** flagged to Security/Compliance, no code change without a product decision
on introducing `tenant_id` app-wide. Do not implement in this module in isolation — see
CONTRADICTIONS.md C4 for why (adding it only to `Mapping` while every other entity stays unscoped
would be inconsistent and likely worse than the status quo).

**Action for whoever is coordinating `mapper_tasks/`:** track this as a dependency/blocker on the
"Security/compliance sign-off" Definition-of-Done checkbox, not as a task to schedule engineering
work against, until a decision comes back from Security/Compliance.
