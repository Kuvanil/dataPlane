# ACI External Tools Integration — Enhancements (second pass)

Second-pass findings, 2026-07-15. Robustness/quality items surfaced during the
deeper validation review (correctness defects are in `bugs2.md`). The first
pass's open items in `enhancements.md` (live outage/recovery walkthrough;
operator health probe/metric; Task #10 tenant isolation) still stand.

## Open

1. **The external-action intent blocks the synchronous `/ask` request path on
   ACI tool discovery.** `askdata_pipeline_service._handle_external_action`
   runs inside the sync `/ask` handler and calls `aci_client.search_tools`,
   which — while the breaker is still closed — retries `ACI_MAX_RETRIES+1`
   times with `1s + 2s + 4s = 7s` of blocking `time.sleep` before failing.
   The first ACI outage therefore hangs the request thread ~7s (fast only
   once the breaker has opened). This contradicts INDEX design decision #5
   ("Async dispatch, never block a request path on an external API
   round-trip"). Consider no-retry (or a tight timeout) for the request-path
   discovery call, or moving tool discovery off the request thread the same
   way notify-out already runs in a Celery task.

2. **PUT `/integrations/notification-settings/{event_key}` accepts arbitrary
   event keys.** `event_key` is a free-form path parameter, never checked
   against the known namespaces (`autopilot:*` / `pipeline:*` /
   `agentic_dba:*`). `PUT …/typo:run_failure {"enabled": true}` silently
   persists a row that will never fire and pollutes the GET listing.
   Admin-gated so not exploitable, but there's no boundary validation of the
   key against a registry of valid event keys. Add a known-key allow-list (or
   a registry the trigger sites and this endpoint share) and reject unknown
   keys with a 422.
