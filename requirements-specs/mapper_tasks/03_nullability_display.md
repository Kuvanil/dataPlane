# Task #3 — Nullability is not displayed in the schema panels

**TRD reference:** FR1 — "The system shall display the selected source schema and target schema
as two panels, each listing tables and their columns with data type, nullability, and key
indicators."

**Gap:** `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`'s `ColumnNode`
interface (lines 21-29) has fields for `type` and `primary_key`, but no `nullable` field:

```ts
interface ColumnNode {
  id: string;
  table: string;
  column: string;
  type: string;
  primary_key: boolean;
  edge_id?: number;
  side: "source" | "target";
}
```

`flattenSchema` (lines 237-255) doesn't read or forward a `nullable` value either, and
`SchemaPanel`'s row rendering (lines 295-346) only ever shows the 🔑 PK icon and the type label —
never nullability. This isn't a missing-data problem: the connector schema endpoint already
returns `nullable` per column (`backend/app/connectors/jdbc.py:63`:
`"nullable": col.get("nullable", True)`, confirmed present in the base connector contract too —
`backend/app/connectors/base.py:29`). It's purely dropped on the way into the Canvas UI.

Note: `EdgeInspector.tsx` (lines 45-49) already displays nullability, but only for a column
*after* it's been mapped into an edge (`edge.target.nullable === false ? "· NOT NULL" : ""`).
The gap is specifically in the raw schema-browsing panels, before a column has been mapped —
which is what FR1 is actually describing ("display the... schema... each listing tables and
their columns with... nullability").

## Changes

### 1. `frontend/src/app/dashboard/schema-mapper/components/Canvas.tsx`
- Add `nullable: boolean` to `ColumnNode`.
- In `flattenSchema`, read `col.nullable` (the connector payload already provides it; default to
  `true` to match the backend's own default in `jdbc.py:63` if a connector implementation ever
  omits it) and include it in the pushed node.
- In `SchemaPanel`'s row rendering, add a small indicator next to the existing type label — e.g.
  a `*` suffix on the type for NOT NULL columns (`{n.type}{n.nullable ? "" : "*"}"`), or a
  separate short badge, consistent with the existing compact `text-[10px]` style used for the
  type label. Keep it visually lightweight — this is a dense list of potentially hundreds of
  rows (see task #4), so avoid adding a second full-width badge per row.
- Update the type signature the two `api.get<...>` calls expect (lines 88-93) to include
  `nullable?: boolean` in the inline column type, matching what the endpoint actually returns.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Manual check: open a mapping whose source/target connections have a mix of nullable and
NOT NULL columns, confirm the distinction is visible in both schema panels before any mapping
exists (not just in `EdgeInspector` after mapping).

## Risk

- Purely additive UI change, no data model or API change — the data was already being fetched
  and simply not rendered. Lowest-risk task in this set.
