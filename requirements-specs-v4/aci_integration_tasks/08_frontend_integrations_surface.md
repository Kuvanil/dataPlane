# Task #8 — Frontend: connected apps/linked-accounts surface

**Reference:** TRD §5 FR7; INDEX.md design decision #6 (deep-link, don't rebuild ACI's OAuth UX).
Depends on #2 (linked-account data to display).

**Goal:** A minimal page showing which external apps/linked accounts are connected via ACI and
which dataPlane action types (Task #3's registry) can use them — not a rebuild of ACI's own
dev-portal OAuth-connect flow.

## Changes

### 1. New backend endpoint
- `GET /api/v1/integrations/linked-accounts` — thin wrapper over
  `aci_client_service.list_linked_accounts()`, auth-gated the same way every other data-bearing
  route in this app is (`get_current_user`, per `SKILLS.md` §1's established pattern).

### 2. New frontend route: `frontend/src/app/dashboard/integrations/page.tsx`
- Lists connected apps/linked accounts (name, connected app type, status) and, for each, which
  registered action types (Task #3) are available to use it.
- A "Connect a new app" action **deep-links out to ACI's own dev portal** (its OAuth-connect UI) —
  do not build a parallel OAuth flow inside dataPlane's frontend. Confirm the exact portal URL
  pattern from Task #1's deployment before wiring this link.
- New sidebar entry in `layout.tsx`'s `menuItems` array — `Integrations` (or fold into an existing
  section like `Security`/`Connectors` if that reads more naturally once actually built; this is a
  UX judgment call worth a quick look at the existing sidebar's information architecture before
  deciding).

### 3. Tests
- `frontend/src/app/dashboard/integrations/__tests__/page.test.tsx` — renders a fixture list of
  linked accounts, confirms the "connect new app" link points at the configured ACI portal URL
  rather than a dataPlane-internal route.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd frontend && npx vitest run
```
Manually: with at least one app connected via ACI's portal, confirm it shows up correctly on this
page.

## Risk

- Low — deliberately thin scope (decision #6) keeps this from becoming a large frontend
  undertaking; resist the urge to build connect/disconnect flows in dataPlane's own UI once this
  page exists — that's explicitly ACI's job.
