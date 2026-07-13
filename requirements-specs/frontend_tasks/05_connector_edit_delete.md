# Task #5 — Add Edit, Soft-Delete, and Credential Rotation to Connectors Page

**TRD reference:** `TRD_DataPlane_Connectors.md` (FR6, FR7, FR9)
**Bug(s):** Bug 06 (High)
**Priority:** High

## Current State

The `/dashboard/connectors` page renders a list of connectors with create/test/scan capabilities. Each connector card shows name, type, config preview, health status, and action buttons (Test Conn, Scan Schema).

**What exists:**
- Connector list with type icons and health indicators
- Create connector modal with type selector and JSON config editor
- Test Connection with pass/fail diagnostics
- Scan Schema modal showing table/column structure
- Error banner for API failures

**What does NOT exist:**
- Edit non-secret fields (FR6) — no edit button or modal
- Credential rotation without exposing existing secrets (FR6) — no rotation UI
- Dependency-aware soft delete with warnings (FR7) — no delete button
- Live health status auto-polling (FR5 partial)
- Audit event display for connector actions (FR9 partial)
- Loading/empty states for individual operations

## Scope

### 1. Add edit functionality to existing connector cards

Add an "Edit" button to each connector card that opens an edit modal pre-populated with existing values (except secrets).

### 2. Components to build/modify

#### `EditConnectorModal` — Edit connector (modify existing `CreateConnectorModal` pattern)
- Pre-populated name field
- Type selector (disabled — type cannot be changed after creation)
- Config JSON editor pre-filled with existing non-secret config
- Secret fields shown as "••••••••" with "Change" button
- "Change" button reveals new secret fields (never show existing secret values)
- Save button → `PUT /api/v1/connectors/{id}`
- Cancel button
- Validation: config JSON must be valid
- Loading state during save
- Error state on save failure

#### `DeleteConnectorDialog` — Soft-delete with dependency check
- "Delete" button on each connector card (with confirmation)
- On click: first check dependencies via `GET /api/v1/connectors/{id}/dependencies`
- If dependencies exist:
  - Show warning: "This connection is used by N mapping(s) and M pipeline(s)"
  - List dependent mappings and pipelines with links
  - "Delete anyway" button (soft-delete, sets `is_deleted=True`)
  - "Cancel" button
- If no dependencies:
  - Simple confirmation: "Are you sure you want to delete {name}?"
  - "Delete" and "Cancel" buttons
- Loading state during dependency check
- Success toast on deletion
- Error state on delete failure

#### `CredentialRotationModal` — Rotate credentials
- "Rotate Credentials" button on each connector card
- Modal with fields for new credentials (type-specific: password, API key, token, etc.)
- "Test new credentials" button → `POST /api/v1/connectors/{id}/test` with new creds
- "Save new credentials" button → `PUT /api/v1/connectors/{id}/rotate`
- Never show existing credential values
- Success toast on rotation
- Error state on rotation failure

#### `HealthStatusPolling` — Live health status (modify existing)
- Add auto-polling of health status every 30 seconds
- Use `GET /api/v1/connectors/{id}` to get current `health_status`
- Update health indicator dot without full page refresh
- Pause polling when tab is hidden
- Stop polling on component unmount

#### `ConnectorAuditLog` — Per-connector audit events
- "View Activity" button on each connector card
- Slide-out panel or modal showing recent audit events for this connector
- Events: created, tested, edited, credentials rotated, schema scanned, deleted
- Columns: timestamp, action, actor, details
- Link to full Audit Trail
- Loading/empty/error states

### 3. Card action buttons update

Current card actions:
```
[Test Conn] [Scan Schema]
```

New card actions:
```
[Test Conn] [Scan Schema] [Edit] [Rotate Credentials] [View Activity] [Delete]
```

Group into primary and secondary actions to avoid clutter:
```
Primary: [Test Conn] [Scan Schema]
Secondary (dropdown or expand): [Edit] [Rotate Credentials] [View Activity] [Delete]
```

### 4. Data flow

```
Edit → GET /api/v1/connectors/{id} → pre-populate form
     → PUT /api/v1/connectors/{id} → save changes

Delete → GET /api/v1/connectors/{id}/dependencies → check deps
       → DELETE /api/v1/connectors/{id} → soft delete

Rotate → POST /api/v1/connectors/{id}/rotate → rotate credentials
       → POST /api/v1/connectors/{id}/test → test new credentials

Health → GET /api/v1/connectors/{id} → poll every 30s
       → update health_status in state

Audit → GET /api/v1/audit?target_type=connection&target_id={id} → events
```

## Dependencies

- Backend: `PUT /api/v1/connectors/{id}` update endpoint (CONN-T8)
- Backend: `DELETE /api/v1/connectors/{id}` soft-delete endpoint (CONN-T7)
- Backend: `GET /api/v1/connectors/{id}/dependencies` dependency check (CONN-T7)
- Backend: `POST /api/v1/connectors/{id}/rotate` credential rotation (CONN-T8)
- Backend: Audit Trail API filtered by target type/id

## Edge Cases

- **Edit with no changes:** Disable Save button if no fields changed
- **Edit with invalid config JSON:** Show inline validation error, prevent save
- **Delete with no dependencies:** Simple confirmation, no warning list
- **Delete with many dependencies (>10):** Show count with "View all" link
- **Credential rotation with test failure:** Show test failure details, allow retry or cancel
- **Health poll failure:** Don't update status (keep last known), don't show error
- **Health poll for deleted connector:** Stop polling if connector is deleted
- **Multiple rapid edits:** Debounce or disable save during previous save
- **Concurrent edit conflict:** If another user edited the connector, show "This connector was modified by another user. Refresh and try again."

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
cd frontend && npx vitest run
```

- Edit modal opens with pre-populated fields
- Edit saves correctly and updates the list
- Delete with dependencies shows warning list
- Delete without dependencies shows simple confirmation
- Soft-deleted connector disappears from list
- Credential rotation modal opens and saves
- Health status updates via polling
- Audit log shows connector events
- All modals have loading/error states
- Card actions are properly grouped

## Risk

Low-Medium. This task modifies an existing page with clear patterns to follow. Key risks:
1. Backend update/delete/rotate endpoints may not exist yet
2. Dependency check API needs to be built
3. Credential rotation must never expose existing secrets — careful API contract review needed
4. Health polling should not cause performance issues with many connectors