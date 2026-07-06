# Task #11 — Credential vaulting sign-off (cross-reference, not a new implementation task)

**TRD reference:** §5 Security NFR ("Execution uses governed connection credentials (vaulted)"),
§9 Assumption ("Connection credentials are governed via Connectors/secret manager"), §10 Risk
table (implicitly — unauthorized/insecure execution).

**Status: `[!]` blocked — cross-module dependency, not owned by this directory.**

Same shape as `mapper_tasks/07_tenant_isolation_signoff.md`: this is a TRD requirement that
Pipelines depends on but does not itself implement. Connection credential vaulting is owned by
the Connectors module / platform-infra team (per the TRD's own Dependencies section: "Connection
management (owned by Connectors)" is explicitly out-of-scope for Pipelines).

**Gap found during audit:** the original `Pipelines_tasks/INDEX.md` (v1) listed this under
"Out of scope (not in any phase; out of TRD)" as "Secret vaulting for connection credentials
(TRD NFR §5; deferred to platform/infra team)" with no tracking beyond that one line. Given the
TRD explicitly calls it out as a Security NFR (not merely an assumption), it deserves an explicit
cross-reference entry here rather than a buried bullet, so it isn't lost track of the way it's
easy to lose track of anything marked "out of scope" with no owner or follow-up named.

## What Pipelines needs from this dependency

- `Pipeline.source_connection_id` / `target_connection_id` (Task #1) reference `DBConnection`
  rows — confirm `DBConnection` credential storage is actually vaulted (not e.g. plaintext in the
  connection row) before Pipelines executes production runs against it. This is a verification
  step, not new code in this directory.
- Least-privilege execution (Security NFR) — confirm the credentials a pipeline run uses are
  scoped to only what that pipeline needs (read on source, write on target), not a shared
  broad-privilege service account, before sign-off.

## Action

- Cross-reference with whatever tracks Connectors module work (no `Connectors_tasks/` directory
  exists in `requirements-specs/` today — if/when Connectors' own credential-vaulting work is
  tracked, link it here).
- Do not mark Pipelines' Security NFR as satisfied in this directory's DoD until this is
  confirmed, even though no code in this directory implements it directly.

## Risk

High if silently skipped — this is the same pattern as the tenant-isolation cross-reference in
`mapper_tasks/07_tenant_isolation_signoff.md`: a security-relevant TRD requirement that's easy to
mark "someone else's problem" and then never actually verify with anyone.
