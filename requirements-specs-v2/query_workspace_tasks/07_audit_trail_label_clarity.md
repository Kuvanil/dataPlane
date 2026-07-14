# Task #7 — Verify Audit Trail still distinguishes Ask vs SQL events under one tab

**Reference:** design decision #8 in `INDEX.md`.

**This is a verification task, not a build task.** Confirmed via code read
(`frontend/src/app/dashboard/audit/components/EventTable.tsx:12-13,77-78`,
`FilterBar.tsx:27-43`): the Audit Trail already renders `module` and `event_type` as plain text
columns and filter facets, sourced directly from the backend's `AuditLog` rows — it has **no
clickable link back to the originating feature page**, so there is nothing in the Audit Trail's
own code that hardcodes `/dashboard/askdata` or `/dashboard/query-studio` and would break from the
route consolidation in task #6.

## What to check

1. After task #6 lands, confirm `askdata.question_answered` events (from `askdata.py`) and
   `query.select_executed` / `query.write_executed` / `query.blocked` / `query.error` events (from
   `query_studio.py`) still show distinct `module` values (`askdata` vs. `query_studio` — verify
   the exact strings via `backend/app/services/*_service.py`'s `emit_audit_event` calls) in the
   Audit Trail's Module column and filter dropdown (`FilterBar.tsx:27-33`).
2. Confirm a user reading the Audit Trail can still tell "this was a chat question" from "this was
   a manual SQL execution" purely from `event_type`/`module`, now that both actions are reachable
   from a single sidebar entry labeled "Query Workspace" (or whatever task #6 names it) — i.e. the
   merge doesn't make the two capabilities look like one undifferentiated thing from the audit
   log's perspective, even though they now share one tab in the nav.
3. If either check surfaces genuine ambiguity (e.g. `module` values that read as interchangeable,
   or a UI label that implies "Query Workspace" is itself the module), that's the only case
   requiring an actual change — and it would be a small copy/label fix, not a data-model change.

## Verify

Manually: open the Audit Trail after using both Ask and SQL modes in the merged tab, filter by
each module, confirm the two event sets are cleanly separable.

## Risk

- None expected — this task exists to close the loop explicitly rather than assume silently that
  "no backend change" also means "no UI ambiguity introduced." If it turns out clean (likely,
  given the current implementation), record that finding in the progress log and move on.
