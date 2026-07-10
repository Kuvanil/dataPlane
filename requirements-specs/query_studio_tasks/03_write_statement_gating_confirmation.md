# Task #3 — Write-statement gating + confirmation (QS-T3)

**TRD reference:** FR4 (§4).

**Current state:** No write gating mechanism exists. All SQL execution path currently allows any statement type.

## Scope

Build the write-statement gating system: role-based permission check, explicit user confirmation flow, and clear error paths when writes are blocked. Integrated with the statement classifier from QS-T2.

### Gating logic

1. **Classify** — Use QS-T2 to classify the input SQL.
2. **Role check** — If write/DDL detected, check user's role for write permission:
   - `admin` role → allowed with confirmation
   - `analyst`/`editor` role → allowed with confirmation only if specific write permission granted
   - `viewer` role → always blocked
3. **Confirmation flow** — If write detected and user has permission, return a `requires_confirmation: true` response with the statement type details. The frontend shows a confirmation dialog. User confirms via a second API call.
4. **Execution** — Only execute the statement after confirmation.

### API Contract

```
POST /query/execute
Request: { "connection_id": int, "sql": string, "confirmed": bool (default false) }

Response (if write detected, not confirmed):
{
  "requires_confirmation": true,
  "statement_type": "update",
  "tables_affected": ["customers"],
  "warning": "This statement will modify data in table 'customers'. Are you sure?",
  "confirmation_token": "abc123"
}

Response (if confirmed or read-only):
{
  "query_id": 42,
  "columns": [...],
  "rows": [...],
  ...
}
```

### Dependencies

- **QS-T2** — statement classifier.
- **Security/Auth** — role/permission system.

## Verify

- Test write blocked for viewer role without confirmation.
- Test write allowed for admin role after confirmation.
- Test write blocked for all roles without `confirmed: true`.
- Test confirmation token expires after TTL or single use.
- Test read queries bypass confirmation.

## Risk

Low. Clear flow with established pattern. Token expiration prevents replay.