# Task #1 — Aggregation API (DASH-T1)

**TRD reference:** FR2, FR3, §11 Technical Notes (`GET /api/v1/dashboard/summary?range=7d`).

**Current state:** The frontend (`dashboard/page.tsx`) makes 3–4 separate API calls on load:
`GET /connectors/`, `GET /audit/summary`, `GET /mappings/?limit=1`, and per-connector
`POST /connectors/{id}/test`. There is no unified aggregation endpoint. The
`dashboard_static_ui_tasks/` work wired these individual calls as a tactical fix, but the
TRD specifies a single aggregation API that returns KPIs + feed in one payload.

## Scope

Create a new `GET /api/v1/dashboard/summary?range=7d` endpoint that fans out to existing
module services/endpoints and returns a unified response. Each module call is wrapped in
try/except with a per-module fallback so one down module doesn't kill the whole dashboard.

### Response schema — `backend/app/schemas/dashboard.py` (new)

```python
class KPITile(BaseModel):
    label: str
    value: int
    subtitle: str | None = None
    trend: Literal["up", "down", "neutral"] | None = None
    trend_label: str | None = None
    icon: str | None = None
    link_url: str
    module: str  # e.g. "connectors", "pipelines", "audit", "mappings", "autopilot", "query"
    status: Literal["loaded", "error", "unavailable"]
    error_message: str | None = None

class FeedItem(BaseModel):
    id: int
    event_type: str
    actor: str
    module: str
    summary: str
    status: str
    created_at: datetime
    link_url: str | None = None

class DashboardSummary(BaseModel):
    kpis: list[KPITile]
    feed: list[FeedItem]
    range: str  # echoes back the requested range
    generated_at: datetime
```

### KPI tiles to include

| Tile | Module | Data source | Link URL |
|------|--------|-------------|----------|
| Connected Sources | Connectors | `GET /connectors/` → count | `/dashboard/connectors` |
| Mappings | Schema Mapper | `GET /mappings/?limit=1` → `total` | `/dashboard/schema-mapper` |
| Pipelines Running | Pipelines | `GET /pipelines/?status=running` → count | `/dashboard/pipelines` |
| Pipelines Failed | Pipelines | `GET /pipelines/?status=failed` → count | `/dashboard/pipelines` |
| Queries Today | Query Studio | `GET /query/history?range=24h` → count | `/dashboard/query` |
| Security Alerts | Security | `GET /audit/summary` → `by_event_type["security_alert"]` | `/dashboard/security` |
| Drift Events | Schema Intel | `GET /audit/summary` → `by_event_type["schema_drift_detected"]` | `/dashboard/schema` |
| AI Autopilot Actions | AI Autopilot | `GET /autopilot/runs?range=24h` → count | `/dashboard/autopilot` |

### Activity feed

Consume `GET /audit/?page_size=10` and enrich each event with:
- `module` — derived from `event_type` prefix (e.g. `connector_*` → `connectors`, `pipeline_*` → `pipelines`)
- `summary` — human-readable description derived from `event_type` + `connection_name`
- `link_url` — deep link to the relevant module detail view

### Service — `backend/app/services/dashboard_service.py` (new)

```python
class DashboardService:
    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, range: str = "7d", user=None) -> DashboardSummary:
        """Fan out to all module services and aggregate results."""
        # Each module call is wrapped in try/except
        kpis = []
        feed = []

        # 1. Connectors
        try:
            connectors = self.db.query(DBConnection).filter(
                DBConnection.is_deleted == False  # noqa: E712
            ).all()
            kpis.append(KPITile(
                label="Connected Sources",
                value=len(connectors),
                subtitle=f"{len(set(c.type for c in connectors))} types",
                icon="🔌",
                link_url="/dashboard/connectors",
                module="connectors",
                status="loaded",
            ))
        except Exception as e:
            kpis.append(self._error_tile("Connected Sources", "connectors", str(e)))

        # 2. Mappings
        try:
            total = self.db.query(Mapping).count()
            kpis.append(KPITile(
                label="Mappings",
                value=total,
                icon="🔗",
                link_url="/dashboard/schema-mapper",
                module="mappings",
                status="loaded",
            ))
        except Exception as e:
            kpis.append(self._error_tile("Mappings", "mappings", str(e)))

        # 3. Pipelines (running + failed)
        try:
            running = self.db.query(Pipeline).filter(Pipeline.status == "running").count()
            failed = self.db.query(Pipeline).filter(Pipeline.status == "failed").count()
            kpis.append(KPITile(
                label="Pipelines Running",
                value=running,
                icon="▶️",
                link_url="/dashboard/pipelines",
                module="pipelines",
                status="loaded",
            ))
            kpis.append(KPITile(
                label="Pipelines Failed",
                value=failed,
                subtitle="Requires attention" if failed > 0 else None,
                trend="up" if failed > 0 else "neutral",
                icon="❌",
                link_url="/dashboard/pipelines",
                module="pipelines",
                status="loaded",
            ))
        except Exception as e:
            kpis.append(self._error_tile("Pipelines", "pipelines", str(e)))

        # 4. Audit summary (drift + security alerts)
        try:
            summary = self.db.query(
                AuditLog.event_type,
                func.count(AuditLog.id).label("total")
            ).filter(
                AuditLog.created_at >= range_start
            ).group_by(AuditLog.event_type).all()
            by_type = {row.event_type: row.total for row in summary}
            drift = by_type.get("schema_drift_detected", 0)
            alerts = by_type.get("security_alert", 0)
            kpis.append(KPITile(
                label="Drift Events",
                value=drift,
                trend="up" if drift > 0 else "neutral",
                icon="📊",
                link_url="/dashboard/schema",
                module="schema_intel",
                status="loaded",
            ))
            kpis.append(KPITile(
                label="Security Alerts",
                value=alerts,
                trend="up" if alerts > 0 else "neutral",
                icon="🔒",
                link_url="/dashboard/security",
                module="security",
                status="loaded",
            ))
        except Exception as e:
            kpis.append(self._error_tile("Audit Events", "audit", str(e)))

        # 5. Activity feed from audit log
        try:
            events = self.db.query(AuditLog).order_by(
                AuditLog.created_at.desc()
            ).limit(10).all()
            feed = [self._to_feed_item(e) for e in events]
        except Exception as e:
            feed = []  # Feed is optional; don't add an error tile for it

        return DashboardSummary(
            kpis=kpis,
            feed=feed,
            range=range,
            generated_at=datetime.utcnow(),
        )
```

### Router — `backend/app/api/routers/dashboard.py` (new)

```python
router = APIRouter()

@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    range: str = Query("7d", regex="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service = DashboardService(db)
    return service.get_summary(range=range, user=user)
```

### Wiring — `backend/app/main.py`

Add:
```python
from app.api.routers import dashboard as dashboard_router
app.include_router(dashboard_router.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
```

## Dependencies

- Existing module models: `DBConnection`, `Mapping`, `Pipeline`, `AuditLog`, `AutopilotRun`, `QueryHistory`
- Existing `get_current_user` dependency for auth context
- No new models required — this is a read-only aggregation layer

## Edge cases

- **Module unavailable:** If a module's model doesn't exist yet (e.g. `Pipeline` is still being built), the try/except catches the `ImportError` or `OperationalError` and returns an `"unavailable"` tile instead of failing the whole endpoint.
- **Empty system:** No connectors, no mappings, no pipelines → all tiles show `0` with appropriate subtitles, feed is empty with an empty state message.
- **Invalid range:** The `regex` validator on the `range` query param rejects anything other than `24h`, `7d`, `30d` with a 422.
- **Range boundary:** `range_start` is computed as `datetime.utcnow() - timedelta(hours=24)` for `24h`, `- timedelta(days=7)` for `7d`, `- timedelta(days=30)` for `30d`.
- **Very large counts:** The API returns raw integers; formatting (locale separators) is the frontend's responsibility (Task #4).
- **Concurrent requests:** Stateless — each request fans out independently. Caching is handled by Task #2.
- **User context:** The `user` parameter is passed through for role-scoping (Task #7). For now, all data is returned unfiltered.

## Verify

```bash
cd backend && .venv/bin/pytest tests/dashboard/ -v   # new test dir, see Task #8
```

- `GET /api/v1/dashboard/summary` returns 200 with all KPI tiles and feed.
- `GET /api/v1/dashboard/summary?range=24h` returns data filtered to last 24 hours.
- `GET /api/v1/dashboard/summary?range=invalid` returns 422.
- Each tile has `status: "loaded"` or `"error"` — never missing.
- A tile whose module is unavailable returns `status: "unavailable"` without crashing.

## Risk

Medium. The main risk is the number of downstream queries (6+ module tables) and the
potential for a schema migration on one module to break the dashboard aggregation query.
Mitigation: each module call is isolated in its own try/except, and the response schema
includes a `status` field per tile so the frontend can render partial results.