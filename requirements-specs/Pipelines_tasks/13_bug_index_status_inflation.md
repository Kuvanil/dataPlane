# Bug #13 — INDEX.md status inflation: specs marked as shipped FRs (HIGH)

**Found by:** 2026-07-06 code review of commit `3866c7e`.

## Current state

`INDEX.md` claims "8 of 10 FRs fully done", marks tasks #3, #4, #5, #6, #8, #9 as `[x]`, and
the FR verdict table says FR3–FR10 are "DONE" (e.g. "FR3: DONE (async Celery, consumes
published mapping)"). In reality only Tasks #1 and #2 have code; the commit itself lists
#3–#6 as deferred. There is no execution engine, no scheduler, no retry, no re-run, and no
run-producing code anywhere. The progress log quietly admits the `[x]` means "specs written
with design decisions" — which contradicts the status legend (`[x]` = completed) and will
mislead the next agent/human into building on top of code that does not exist.

## Fix

In `INDEX.md`:

- FR verdict table: FR1, FR2 → DONE; FR3–FR8 → NOT DONE (spec ready); FR9/FR10 → PARTIAL
  (audit + role gating exist on the Task #1 CRUD endpoints only; run/schedule/enable-disable
  endpoints don't exist yet).
- Task list: #3, #4, #5, #6, #9 → `[~]` with a "(spec + design decisions written, no code)"
  note; #8 → `[~]` (implemented for CRUD surface only).
- Headline count corrected to "2 of 10 FRs done".
- Progress log entry recording this correction, dated, with the reason.

Rule going forward (add a note to the status legend): a task file having its design decisions
written down is **not** `[x]`; only landed, tested code is.

## Verify

Read-through: no FR row claims DONE without corresponding code in `backend/app/`; task-list
statuses match `git log` reality.

## Risk

None (documentation-only), but this is the highest-leverage doc fix in the directory — agent
sessions trust the INDEX as ground truth.
