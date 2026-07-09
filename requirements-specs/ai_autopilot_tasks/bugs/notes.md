# Autopilot Bug Round — Lessons for Future Builds

> Distilled from the 5 validated bugs (2026-07-09, all fixed same day). Each lesson is written
> to be applied on the NEXT epic, not just to explain this one. Cross-referenced from
> `MEMORY.md`. Companion to the per-bug files in this directory.

## L1 — Transaction ownership is a contract; write it down and never commit downstream (bug 01)

**Rule:** exactly one function owns each transaction boundary. Anything it calls — service
helpers, executor callables, audit writers — may `flush()` but never `commit()`/`rollback()`
the caller's session.

This repo already had the rule *documented* for one callee (`audit_helper.py`'s SAVEPOINT
contract) and still shipped a violation in a different callee three files away. Documentation
on one function doesn't protect the pattern; the contract belongs in the *interface docstring
of the extension point* (here: `ActionSpec.execute`) so every future implementer sees it.

**The tension that caused it:** "the Celery worker needs this row committed before I dispatch."
Committing early is the tempting fix and it trades atomicity for one race. The right shape is
**dispatch-after-commit**: the callee returns the side effect as a callable
(`DISPATCH_AFTER_COMMIT_KEY`), the transaction owner fires it strictly after its single commit.
This is outbox-lite: same guarantee ordering (state durable → message sent), no new table.

**Corollary found while fixing:** a post-commit side effect can still fail. Decide explicitly
what that means (here: `executed_dispatch_failed` + an `autopilot_dispatch_failed` audit event)
— an unhandled failure after commit is the silent kind.

**Grep before shipping an epic:** `grep -n "db.commit()" app/services/<feature>*.py` and check
every hit against "who owns this transaction?" Any commit not in the boundary-owning function
needs a written justification or a refactor.

## L2 — A sweep over N items must survive item N/2 failing (bug 02)

Batch evaluators/dispatchers (the engine sweep, health-check fan-out, dashboard aggregation)
must wrap the per-item step in try/except-skip-log, or one bad item silently destroys the whole
batch — worse, the Celery wrapper's `rollback()` also discards the *good* items staged before
the bad one. The dashboard epic hit the same class ("per-module try/except MUST rollback per
handler"); this is the second occurrence, which makes it a repo pattern:

**Pattern:** `for item in batch: try: process(item) except KnownErrors: count_skip + warn +
continue`. Always expose the skip count in the return value (`counts["skipped"]`) — a silently
shrinking batch is invisible in dashboards otherwise.

Deployment-order mismatches (evaluator knows an action type the registry doesn't yet) are a
*normal* state during rollout, not an exception — design sweeps for it.

## L3 — ORM bulk `.update()` bypasses the identity map; pair it with refresh/expire (bug 03)

`query(...).update(..., synchronize_session=False)` is the right tool for guarded state
transitions (it's the compare-and-swap), but it leaves any already-loaded Python object stale.
Every same-session read afterwards — including `db.query(...).get`-style lookups, which serve
from the identity map — sees the old state.

**Pattern:** after `commit()` following a bulk update, `db.refresh(obj)`; if still mid-
transaction, `db.expire(obj)` so the next attribute access re-reads. Audit every
`synchronize_session=False` site in a review pass — the ones that return the object (or keep
using it) are the bugs.

The tests originally masked this by calling `db.refresh(rec)` before asserting — a test that
*compensates* for a bug hides it. When a test needs a refresh to pass, ask whether production
callers get that refresh too.

## L4 — Aggregate in the database, not in Python (bug 04)

"Load everything in the window, then keep the newest per key in a dict" works at demo scale and
is quadratic waste at production scale — especially in a beat task that runs every 2 minutes.
The SQL shape for newest-per-group is boring and portable:

```python
latest_ids = (db.query(func.max(T.id).label("max_id"))
              .filter(T.created >= since).group_by(T.key).subquery())
rows = db.query(T).join(latest_ids, T.id == latest_ids.c.max_id).all()
```

`max(id)` is a valid "newest" proxy for insert-ordered tables and is index-friendly; prefer it
over `distinct on` (Postgres-only) when tests run on SQLite.

**Smell to search for in review:** `.all()` followed by a Python loop that only keeps a
fraction of the rows (`setdefault`, `if key in seen: continue`, `[:n]`). Each is a query that
should have a `group_by`, window function, or `limit`.

## L5 — Anything a human will query later needs a structured key, not prose (bug 05)

Free-text reasons are for humans reading one row; enum-like keys are for every query, report,
and compliance answer after that. If an outcome has a *cause taxonomy* (blocked by breaker vs.
rate limit vs. policy vs. prohibition), the taxonomy goes into its own JSON key
(`blocked_by: "breaker"`) **at write time** — you cannot retrofit it onto historical rows once
the prose has been reworded twice.

Rule of thumb: any string you'd be tempted to `LIKE '%...%'` in an audit query should have been
a key. Write the audit *payload* and the action-log *detail* with the same keys so one query
shape works against both tables.

## Cross-cutting: how these were caught, and what wasn't

- All five came from a **post-completion review against the TRD + code**, the same practice that
  caught the pipelines and mapper rounds. Third data point: **post-epic review is not optional**
  — every epic so far has had a fixable round. Budget it into the epic from the start
  (the mapper round-2 lesson said the same about post-review fix batches).
- **Known accepted deviations (documented, not fixed):**
  - `_exec_mapping_suggestions_refresh` calls `MappingService.request_suggestions`, which
    commits internally (it serves the router path where that's correct). Same class as L1 but
    lower stakes: the action is reversible/low-risk and its commit is self-atomic. Fixing it
    means splitting the shared service into commit/no-commit variants — do that if a second
    executor ever needs the no-commit form.
  - A rec left in `executing` by a crash *after* the transition commit but *before* the final
    status write has no automatic recovery (the bug-01 regression test deliberately creates
    this state). Liveness gap, not a safety gap — nothing executes twice (guarded transitions).
    If it shows up in practice: a beat task that demotes `executing` recs older than N minutes
    back to `pending` with an audit event.
- **Test-design lesson:** every bug file's "Detection" section described a test that didn't
  exist. When writing an epic's test plan, add one test per *failure injection point*
  (post-executor failure, mid-sweep bad item, read-after-bulk-update) — happy-path +
  guard-assertion coverage alone scored 65/65 while all five bugs were live.

## Pre-flight checklist for the next epic (copy into its INDEX)

- [ ] Transaction ownership stated in the extension-point docstring; `grep db.commit` audit done.
- [ ] External side effects (queue dispatch, HTTP, email) fire only after the owning commit.
- [ ] Every batch loop skips-and-counts per-item failures; skip count in the return value.
- [ ] Every `synchronize_session=False` paired with refresh/expire or a written reason.
- [ ] No `.all()` + Python-side reduction where SQL `group_by`/`limit`/window does it.
- [ ] Structured keys (not prose) for anything audits/reports will filter on.
- [ ] One failure-injection test per commit boundary and per batch loop.
