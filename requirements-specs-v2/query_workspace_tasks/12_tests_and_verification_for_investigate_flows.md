# Task #12 — Tests + verification for all four investigate entry points

**Reference:** depends on tasks #9, #10, #11 all landing.

## Changes

### 1. Unit tests for the handoff mechanism itself (task #9)
- `writeWorkspaceHandoff`/`readAndClearWorkspaceHandoff` round-trip correctly, and clear the key
  after reading (no double-apply on a second mount).
- Query Workspace shell applies `connectionId`/`mode`/`sql`/`prefillQuestion`/`banner` correctly
  from a handoff, and a `?mode=` param is overridden by a present handoff's `mode` (precedence rule
  from task #9).

### 2. Per-source tests (tasks #10, #11)
- Schema Intel: clicking "Investigate →" on a High-risk classification badge writes a handoff with
  `mode: "ask"` and a `prefillQuestion` naming the correct table/column; clicking it on a drift
  event's changed table writes `mode: "sql"` with the correct `connectionId` traced from the
  snapshot, not a wrong/default one.
- Schema Mapper: clicking "Investigate →" on an `AISuggestion` writes the correct scaffold query
  using its already-resolved fields; clicking it on a `ValidationIssue` correctly resolves the
  edge's source table/column before writing the handoff (this is the one most worth a real test,
  given task #11 Part B's higher risk).

### 3. End-to-end manual walkthrough
1. From Schema Intel, click "Investigate →" on a High-risk PII column → confirm Query Workspace
   opens in Ask mode, correct connection selected, question pre-filled (not sent), banner shown.
2. From Schema Intel, click "Investigate →" on a drift-flagged table → confirm SQL mode, correct
   connection, `SELECT * FROM <table> LIMIT 100;` pre-filled, banner shown.
3. From Schema Mapper, click "Investigate →" on a pending AI suggestion → confirm SQL mode,
   correct source connection, scaffold query naming the right column.
4. From Schema Mapper, click "Investigate →" on a validation issue tied to a real edge → confirm
   the resolved table/column are correct (cross-check against what "Jump to edge #N →" selects for
   the same issue, as a consistency check between the two actions).
5. In each case, confirm the banner is dismissible and that dismissing it doesn't undo the applied
   connection/mode/prefill.

```bash
cd frontend && npm run lint && npm run build
cd frontend && npx vitest run   # confirm exact invocation from package.json
```

## Risk

- If task #11 Part B's edge-resolution work turns out more involved than scoped (e.g.
  `onJumpToEdge`'s resolution path isn't easily reusable from `ValidationPanel`), this task's job
  is to catch that at verification time and record the honest state in the progress log — "3 of 4
  entry points working, validation-issue handoff deferred, here's why" — rather than either
  silently shipping a broken action or forcing a rushed fix.
