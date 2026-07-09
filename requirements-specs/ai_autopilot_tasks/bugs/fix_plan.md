# AI Autopilot — Fix Progress

> All five bugs fixed 2026-07-09 (same day as filing). One regression test per bug (6 new
> tests); suite 335/335; containers rebuilt; live smoke passed. Per-bug resolution notes are
> appended to each bug file; generalized lessons + next-epic pre-flight checklist in
> [notes.md](notes.md).

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 01 | `_exec_migration_execute` commits caller's session | Medium | **Fixed** — dispatch-after-commit via `DISPATCH_AFTER_COMMIT_KEY`; single atomic commit |
| 02 | Engine crashes on registry mismatch | Low | **Fixed** — per-draft skip + `skipped` count in sweep result |
| 03 | Stale ORM object after `_demote_to_queue` | Low | **Fixed** — refresh/expire at all four bulk-update sites |
| 04 | Drift evaluator loads all events without pagination | Low | **Fixed** — newest-per-connection via SQL `group_by` + `max(id)` |
| 05 | Action log lacks structured `blocked_by` | Low | **Fixed** — `blocked_by` key in detail + audit payloads |
