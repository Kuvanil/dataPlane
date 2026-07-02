# Task #6 — Surface connector-load errors (env-flagged demo mode)

**Reviewer finding:** §11.7 (HIGH). The frontend falls back to a hardcoded
list of fictional connections (`CRM_Source_Analytics`, `Finance_Oracle`, etc.
with IDs 1–5) if `/api/v1/connectors/` fails. A user can unknowingly
create a mapping draft against connection IDs that are fabricated display
data, not real system state — a serious correctness and trust defect
in a tool whose entire value proposition is audit/governance trustworthiness.

**Manual decision (CONTRADICTIONS.md C2):** option **B — env-flagged
demo mode**. Keep the hardcoded list only when
`NEXT_PUBLIC_DEMO_MODE === "1"`. Default-off in prod.

## Changes

### 1. `frontend/src/app/dashboard/schema-mapper/components/MappingList.tsx`
- Remove the hardcoded fallback list from the connectors `.catch` block.
- Gate it behind `process.env.NEXT_PUBLIC_DEMO_MODE === "1"`.
- When the env flag is off (default): surface the error as a banner
  with a Retry button; disable the New Mapping button until connectors
  load successfully.

### 2. `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- Same treatment for the `/connectors/{id}/schema` fetch fallback.
- When demo mode is off, a schema-fetch failure surfaces as an error
  banner instead of an empty canvas.

### 3. Documentation
- `frontend/.env.local.example` (if not present): add a commented line
  showing how to enable demo mode for local development.

## Verify

- **Demo mode off (default):** point `NEXT_PUBLIC_API_URL` at an
  unreachable host and open `/dashboard/schema-mapper`. The user must
  see an error banner with a Retry button — never the fabricated list.
- **Demo mode on:** set `NEXT_PUBLIC_DEMO_MODE=1` in `.env.local`,
  restart dev server, and confirm the fallback list still appears
  when the backend is unreachable (so dev workflows continue to work).
- `npm run build` passes.

## Risk

- The dev experience changes for anyone who relied on the implicit
  fallback. Mitigation: the env flag is a one-line change in
  `.env.local` for anyone who wants the old behaviour back.
