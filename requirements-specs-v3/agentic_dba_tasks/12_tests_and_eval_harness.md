# Task #12 — Tests + multi-domain eval harness

**Reference:** TRD §7, §13 DoD; INDEX.md execution order (incremental, not held to the very end in
practice). Depends on #1–#10 (integration/eval coverage needs the real pieces to exist).

## Changes

### 1. Consolidate/complete unit and integration test coverage
- Confirm each task (#1–#10) landed with its own tests per that task's file (this task's job is to
  catch gaps, not duplicate work already done incrementally alongside each task).
- Add an end-to-end integration test: classified request → generated plan → approval → DDL
  execution → draft mapping creation, against a seeded test connection, asserting real persisted
  state at each stage (tables actually exist, mapping actually has the right edges) — not just that
  each service function returned successfully in isolation.

### 2. Multi-domain eval harness — the part most at risk of being skipped
- The triggering example was retail analytics, but decision #11 (templates + LLM adaptation) and
  FR10 (extensible, not hardcoded per-domain) only mean something if the system is actually
  exercised against **more than one domain**. Build a small eval set (aim for at least 3-4 varied
  domains/requests — e.g. a different vertical, a request with an ambiguous/missing connection to
  confirm the clarifying-question path, a request against a connection with no profiling yet, a
  request whose target table name collides with an existing one) and check plan-quality
  expectations aren't wildly domain-specific hacks.
- This doesn't need to be a fully automated LLM-graded eval pipeline for a first cut — a documented,
  repeatable manual review checklist run against the eval set is an acceptable starting point;
  automate later if usage volume justifies it. **Do not skip this and call the epic done on the
  retail example alone** — that would silently reproduce exactly the "hardcoded to one domain"
  failure mode this epic exists to avoid.

### 3. Final verification pass
```bash
cd backend && pytest tests/agentic_dba/ tests/askdata/ -v
cd frontend && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```
Manually: run the original retail-analytics example end-to-end through the real UI, plus at least
one other domain from the eval set, and confirm both produce sensible, reviewable plans — not just
that the retail one (the one everyone's seen) works.

## Verify

Per repo convention: don't claim done on type-check/green-tests alone — the manual multi-domain
walkthrough above is the actual acceptance bar for this task, since plan *quality* (not just "the
code runs") is what's being verified.

## Risk

- The eval harness is the task most likely to get shortchanged under time pressure since its ROI
  is "prevents a future embarrassing single-domain regression" rather than a visible feature. Treat
  it as a required deliverable, not optional polish — record explicitly in the progress log if it
  ends up deferred, rather than silently skipping it.
