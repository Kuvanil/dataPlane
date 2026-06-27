# Mapping Artifact JSON Contract

> **For:** Pipelines / AI Autopilot teams consuming `GET /api/v1/mappings/{id}/export`
> **Version:** 1.0
> **Spec:** `docs/superpowers/specs/2026-06-27-schema-mapper-upgrade-design.md` §10

## 1. Endpoint

```
GET /api/v1/mappings/{mapping_id}/export
GET /api/v1/mappings/{mapping_id}/export?version_id={version_id}
```

- Auth: `Authorization: Bearer <jwt>` (any authenticated user).
- `version_id` is optional. When omitted, returns the mapping's current (latest) published version.
- Returns `409` if the mapping has no published version.
- Returns `404` if the mapping does not exist.
- Returns `403` if unauthenticated.

## 2. Top-level shape

```json
{
  "mapping_id": 42,
  "name": "CRM → DW Customer Sync",
  "version": 3,
  "status": "published",
  "published_at": "2026-06-27T10:11:12.345678+00:00",
  "published_by": "admin@dataplane.ai",
  "source": {
    "connection_id": 1,
    "name": "CRM_Source_Analytics",
    "type": "sqlite"
  },
  "target": {
    "connection_id": 2,
    "name": "Data_Warehouse_Target",
    "type": "sqlite"
  },
  "field_mappings": [
    /* see §3 */
  ],
  "schema_snapshot": {
    "source": { "/* captured at publish time */" },
    "target": { "/* captured at publish time */" }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `mapping_id` | int | Stable across versions |
| `name` | string | Display name at publish time |
| `version` | int | 1-indexed per mapping, monotonic |
| `status` | string | Always `"published"` for this endpoint |
| `published_at` | ISO 8601 string | UTC, with timezone offset |
| `published_by` | string | User email |
| `source` | object | `{connection_id, name, type}` |
| `target` | object | `{connection_id, name, type}` |
| `field_mappings` | array | Immutable copy pinned at publish time |
| `schema_snapshot` | object | `{source: {...}, target: {...}}` captured from connectors at publish time |

## 3. Field mapping entry

```json
{
  "id": 19,
  "origin": "ai_accepted",
  "ai_confidence": 0.92,
  "target": {
    "table": "dw_customers",
    "column": "contact_email",
    "type": "VARCHAR",
    "nullable": false,
    "primary_key": false
  },
  "sources": [
    {
      "table": "crm_users",
      "column": "email_address",
      "type": "TEXT",
      "nullable": true
    }
  ],
  "transformation": {
    "kind": "cast",
    "from": "TEXT",
    "to": "VARCHAR"
  },
  "audit": {
    "created_by": "admin@dataplane.ai",
    "created_at": "2026-06-27T09:55:01.123456+00:00",
    "updated_by": "admin@dataplane.ai",
    "updated_at": "2026-06-27T09:55:01.123456+00:00"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | int | Internal `FieldMapping.id` |
| `origin` | enum | `"manual"` \| `"ai_accepted"` \| `"english_parsed"` |
| `ai_confidence` | float \| null | 0.0–1.0 when `origin == "ai_accepted"`, else `null` |
| `target` | object | Single target column reference |
| `target.table` | string | Target table name |
| `target.column` | string | Target column name |
| `target.type` | string \| null | SQL type label (e.g. `"VARCHAR"`, `"INTEGER"`) |
| `target.nullable` | bool \| null | True / False / null (unknown) |
| `target.primary_key` | bool | True iff target is the PK |
| `sources` | array | 1..N source columns (1:1 or N:1) |
| `sources[].table` | string | Source table name |
| `sources[].column` | string | Source column name |
| `sources[].type` | string \| null | SQL type label |
| `sources[].nullable` | bool \| null | True / False / null (unknown) |
| `transformation` | object | One of the 11 allowed kinds — see §4 |
| `audit` | object | `{created_by, created_at, updated_by, updated_at}` ISO timestamps |

## 4. Allowed transformation kinds

11 values for `transformation.kind`. Source-column references count as positional `%s` placeholders; literal placeholders are appended in payload-declaration order.

| `kind` | Payload shape | SQL output pattern |
|---|---|---|
| `direct` | `{}` | `%s` |
| `cast` | `{from: str, to: str}` | `CAST(%s AS {to})` |
| `concat` | `{parts: [{kind:"literal", value:str} \| {kind:"source"}]}` | `(`%s` \|\| `%s` ...)` |
| `substring` | `{source_index: int, start: int, length: int}` | `SUBSTRING(%s, {start+1}, {length})` |
| `coalesce` | `{fallback_kind: "literal", fallback_value: any}` | `COALESCE(%s, %s)` |
| `upper` | `{}` | `UPPER(%s)` |
| `lower` | `{}` | `LOWER(%s)` |
| `trim` | `{}` | `TRIM(%s)` |
| `default` | `{value_kind: "literal", value: any}` | `COALESCE(%s, %s)` |
| `null_if` | `{equals: any}` | `NULLIF(%s, %s)` |
| `lookup` | `{table: str, key_column: str, value_column: str, default?: any}` | `(SELECT {value_column} FROM {table} WHERE {key_column} = %s[, %s])` |

Anything not in this list is rejected at `add_edge` / `update_edge_transformation` time with HTTP `422` and body:

```json
{
  "detail": {
    "kind": "grammar_error",
    "message": "unknown transformation kind 'foo'; allowed: [...]",
    "location": "kind"
  }
}
```

No freeform DSL. No function calls. No string interpolation of user data into SQL.

## 5. Versioning & immutability

- Each publish creates a new `mapping_versions` row.
- `version_number` is monotonic per mapping (1, 2, 3, ...).
- `mapping_versions.edges_snapshot` is an **immutable** copy of the draft edges at publish time. Pipelines **must** read from this snapshot, not from the live `field_mappings` table.
- `mapping_versions.schema_snapshot` is captured from source/target connectors at publish time. If the live schema drifts after publish, Pipelines should either:
  - execute against the snapshot as-is (deterministic, governed), OR
  - refuse and surface a "schema drift" error if they require live validation.
- A new draft edit does **not** retroactively change a published version.
- Mapping deletion (soft-delete) is blocked on published mappings; archive instead.

## 6. Errors

| Status | Body | Cause |
|---|---|---|
| `200` | artifact JSON | Success |
| `401` | `{detail:"Not authenticated"}` | Missing/invalid JWT |
| `403` | `{detail:"role ... not authorized"}` | Wrong role (this endpoint allows any authenticated user) |
| `404` | `{detail:"mapping not found"}` | Unknown mapping id |
| `409` | `{detail:"no published version to export"}` | Mapping has no published version |
| `409` | `{detail:"version N is not published"}` | `version_id` refers to a draft version |

## 7. Example consumer

```python
import httpx

API_BASE = "http://localhost:8000"
token = "<jwt>"

artifact = httpx.get(
    f"{API_BASE}/api/v1/mappings/42/export",
    headers={"Authorization": f"Bearer {token}"},
    timeout=30,
).json()

print(f"Mapping #{artifact['mapping_id']} v{artifact['version']} ({artifact['status']})")
for fm in artifact["field_mappings"]:
    src = ", ".join(f"{s['table']}.{s['column']}" for s in fm["sources"])
    print(
        f"  {fm['target']['table']}.{fm['target']['column']} "
        f"<- {src} via {fm['transformation']['kind']}"
    )
```

## 8. Example curl

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mappings/42/export \
  | jq '.field_mappings[0]'
```

## 9. Change log

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-06-27 | Initial contract. 11 transformation kinds. Versioning + immutability semantics. |
