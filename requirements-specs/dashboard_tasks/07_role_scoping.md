# Task #7 — Role-Scoping for Dashboard Data (DASH-T7)

**TRD reference:** FR7 (dashboard data reflects only resources the user's role is permitted to view), Security NFR (all aggregated data role-scoped).

**Current state:** Individual module endpoints (connectors, pipelines, mappings) are role-gated using the existing `require_role` dependency from `backend/app/api/deps.py`. However, the dashboard aggregation API (Task #1) does not yet filter its results based on the user's role. An admin user sees the same dashboard as an analyst user.

## Scope

Apply role-based filtering to the dashboard aggregation API so each user sees only the data their role permits. The existing role infrastructure is reused — no new roles or permissions are introduced.

### Role definitions (existing, from `auth_service.py`)

| Role | Scope | Dashboard impact |
|------|-------|-----------------|
| `admin` | Full access | All tiles visible with all data |
| `analyst` | Read access to connectors, mappings, pipelines, audit | All tiles visible with all data (same as admin for dashboard purposes) |
| `viewer` | Read-only access to published/pre-existing data | All tiles visible but at a high level only (no drill-through to sensitive modules) |

### Implementation — `backend/app/services/dashboard_service.py`

Add a `filter_by_role()` method that post-processes the aggregated data:

```python
def _filter_by_role(self, summary: DashboardSummary, user) -> DashboardSummary:
    """Filter dashboard data based on user role."""
    role = getattr(user, "role", "viewer")

    if role == "admin" or role == "analyst":
        # Admin and analyst see all data
        return summary

    # viewer: Show only non-sensitive tiles, remove feed items from restricted modules
    restricted_modules = {"security", "autopilot", "audit"}

    filtered_kpis = [
        kpi for kpi in summary.kpis
        if kpi.module not in restricted_modules
    ]

    filtered_feed = [
        item for item in summary.feed
        if item.module not in restricted_modules
    ]

    # For sensitive tiles, replace with a "restricted" placeholder
    for kpi in summary.kpis:
        if kpi.module in restricted_modules:
            filtered_kpis.append(KPITile(
                label=kpi.label,
                value=0,
                subtitle="Restricted",
                icon=kpi.icon,
                link_url="",
                module=kpi.module,
                status="unavailable",
                error_message="You do not have permission to view this data.",
            ))

    return DashboardSummary(
        kpis=filtered_kpis,
        feed=filtered_feed,
        range=summary.range,
        generated_at=summary.generated_at,
    )
```

### Integration in the router

```python
@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    range: str = Query("7d", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = DashboardService(db)
    summary = service.get_summary(range=range, user=user)
    return service._filter_by_role(summary, user)
```

### Frontend handling of restricted tiles

The `KPITile` component already handles `status: "unavailable"` by showing an error state with the message from `error_message`. No frontend changes needed for restricted tiles — they render the same way as an unavailable module.

For the activity feed, restricted items are simply filtered out on the backend. The viewer user sees fewer feed entries, but the feed does not show "X items hidden" — the user doesn't know restricted items existed.

### Audit scope considerations

The aggregation API does not record its own audit event (it's a read-only aggregation of other modules' data). Therefore, no audit-related role scoping is needed for the dashboard itself.

### Decision — Dashboard role-scoping depth

Two options were considered:

1. **Server-side filtering (chosen):** The aggregation API receives the user context, fetches all data, then filters the response before returning. This is simpler and keeps role logic in one place.

2. **Client-side filtering:** The frontend receives all data and hides restricted tiles based on the user's role. This leaks data to the client that the user shouldn't see — rejected for security reasons.

## Dependencies

- Task #1 (aggregation API — the `get_summary()` method is modified to accept and use the `user` parameter)
- Existing `get_current_user` dependency and `require_role` infrastructure

## Edge cases

- **Unknown role:** If a user has a role that doesn't match `admin`, `analyst`, or `viewer`, the code defaults to `viewer`-level filtering (safe default — least privilege).
- **User with no role:** `getattr(user, "role", "viewer")` defaults to `viewer` (safe default).
- **Admin downgraded to viewer mid-session:** Role changes take effect on the next API request (no session invalidation needed). The aggregation API checks the role on every request.
- **Empty filtered feed for viewers:** A viewer with no visible feed items sees the standard empty state: "No activity yet."
- **All tiles restricted:** If a viewer has no access to any module, all tiles show "Restricted" with an unavailable state. The dashboard is essentially empty for that user — this is expected behavior for a user with no permissions.
- **Mixed visibility:** Some tiles loaded, some restricted. The loaded tiles render normally; restricted tiles render the unavailable state. This is the most common case for viewer users.

## Verify

```bash
cd backend && .venv/bin/pytest tests/dashboard/ -v
```

- Admin user sees all 8 KPI tiles with real data.
- Analyst user sees all 8 KPI tiles with real data.
- Viewer user sees 6 of 8 tiles (security and autopilot are restricted) + 2 restricted placeholders.
- Viewer user's activity feed has no items from restricted modules.
- User with unknown role defaults to viewer-level filtering.
- API returns 200 for all roles (never 403 on the dashboard endpoint itself — role filtering is done in-band).

## Risk

Low. The role infrastructure already exists and is tested. This task applies the same pattern to the dashboard aggregation layer. The main risk is forgetting to add a new module to `restricted_modules` — mitigated by the explicit list in `_filter_by_role()`.