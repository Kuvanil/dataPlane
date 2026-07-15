# Task #9 — [?] Optional: "Launch in KeeperDB" deep link from Connectors UI

**Reference:** TRD §3 In-Scope (optional), §10 Assumptions. Independent of the vaulting tasks
(#1–#8) — this is a separate, much smaller convenience idea for human DBAs, not a dependency of
the credential-vaulting work.

## ⚠️ Open — needs product/adoption confirmation, not auto-implementable

**Why this stays `[?]` instead of being scoped as a normal task:** KeeperDB is only useful as a
deep-link target for organizations that already manage the underlying database through KeeperPAM
(i.e. the database itself has a PAM vault record, with the Gateway able to broker a privileged
session). dataPlane has no way to know whether that's true for a given org's databases without
asking. Building this speculatively risks shipping a UI affordance ("Launch in KeeperDB") that's
dead/non-functional for every org that doesn't already use KeeperPAM — which this repo's
non-negotiables explicitly warn against ("No placeholder/mock UI... wire buttons to real endpoints
or don't ship them").

**The question for product:** does dataPlane's target user base (or a specific pilot customer)
already use KeeperPAM to manage privileged access to the same Postgres/MySQL/Oracle instances
connected as dataPlane connectors? If yes, this task becomes concrete: dataPlane's Connectors page
gains a "Launch in KeeperDB" action per connection, which deep-links to that connection's KeeperPAM
vault-record URL (if one is recorded — would require a new optional field on `DBConnection`, e.g.
`keeperpam_record_url`, populated manually by an admin who knows the mapping). If no, this task
should be dropped, not built speculatively.

## What this explicitly is NOT

- Not a replacement for Query Studio (dataPlane's own in-browser SQL editor already covers the
  "run a quick query" need).
- Not an automatic discovery/mapping of dataPlane connections to KeeperPAM vault records — that
  would require a KeeperPAM API integration to look up records by host/port, which is a much
  larger scope than a deep link and is not what's proposed here.
- Not a dependency of Tasks #1–#8 — the vaulting epic is complete and valuable without this.

## If greenlit, minimal scope

- One nullable field on `DBConnection` (or a small side table) for an admin-entered KeeperPAM
  record URL.
- One button/link in the Connectors UI, shown only when that field is populated, opening the URL
  in a new tab — no new backend logic beyond storing and returning that URL.

## Verify

N/A until greenlit — this task's "done" state today is "explicitly raised, not silently dropped
or silently built."

## Risk

- Low if dropped. Medium if built speculatively without confirmed adoption (dead UI affordance,
  wasted engineering effort, and it fights this repo's own no-placeholder-UI rule).
