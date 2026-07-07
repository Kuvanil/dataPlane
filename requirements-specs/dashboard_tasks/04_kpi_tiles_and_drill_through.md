# Task #4 — KPI Tiles with Drill-Through Navigation (DASH-T4)

**TRD reference:** FR2 (KPI tiles for active connectors, running/failed pipelines, queries, security alerts), FR5 (drill-through navigation to each module).

**Current state:** The `dashboard_static_ui_tasks/` work (#1) wired metric tiles to live API endpoints, showing counts for Connected Sources, Mappings, Audit Events, and Drift Events. However:
- There are no tiles for Pipelines running/failed, Queries today, or Security Alerts.
- None of the tiles are clickable (no drill-through navigation exists).
- Tile values are not formatted (no locale-aware number formatting).

## Scope

Build the KPI tile UI components and wire them to the aggregation API (Task #1). Each tile is a card that displays a label, value, icon, optional subtitle, trend indicator, and links to the relevant module.

### Component — `frontend/src/app/dashboard/components/KPITile.tsx` (new)

```tsx
interface KPITileProps {
  label: string;
  value: number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  icon?: string;
  linkUrl: string;
  status: "loaded" | "error" | "unavailable";
  errorMessage?: string;
}

/**
 * KPITile — Displays a single KPI metric as a clickable card.
 *
 * States:
 * - loaded: Shows value, icon, subtitle, and trend indicator
 * - error: Shows error state (reuses DashboardWidget error state)
 * - unavailable: Shows "N/A" with explanation tooltip
 *
 * Drill-through: Entire card is wrapped in a <Link> to linkUrl when status=loaded.
 */
export function KPITile({
  label, value, subtitle, trend, trendLabel, icon, linkUrl, status, errorMessage,
}: KPITileProps) {
  if (status === "error" || status === "unavailable") {
    return (
      <DashboardWidget title={label} icon={icon} isLoading={false} isEmpty={false}
        isError={true} errorMessage={errorMessage || "Module not available"}
      />
    );
  }

  return (
    <Link href={linkUrl} className="kpi-tile block p-4 border rounded-lg hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-xl" role="img" aria-hidden="true">{icon}</span>}
        <h3 className="text-sm font-medium text-gray-600">{label}</h3>
      </div>
      <div className="kpi-value text-3xl font-bold">
        {value.toLocaleString()}
      </div>
      {subtitle && (
        <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
      )}
      {trend && trend !== "neutral" && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${
          trend === "up" ? "text-red-600" : "text-green-600"
        }`}>
          <span>{trend === "up" ? "↑" : "↓"}</span>
          {trendLabel && <span>{trendLabel}</span>}
        </div>
      )}
    </Link>
  );
}
```

### Integration in `dashboard/page.tsx`

The aggregation API (Task #1) returns KPI tiles as an array. The dashboard page iterates over them and renders each as a `KPITile`:

```tsx
// Inside the main dashboard layout
<div className="kpi-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  {summary.data?.kpis.map((kpi) => (
    <KPITile
      key={kpi.label}
      label={kpi.label}
      value={kpi.value}
      subtitle={kpi.subtitle}
      trend={kpi.trend}
      trendLabel={kpi.trend_label}
      icon={kpi.icon}
      linkUrl={kpi.link_url}
      status={kpi.status}
      errorMessage={kpi.error_message}
    />
  ))}
</div>
```

### Drill-through routes mapping

| Tile label | Link URL | Target page |
|------------|----------|-------------|
| Connected Sources | `/dashboard/connectors` | Connectors list |
| Mappings | `/dashboard/schema-mapper` | Schema Mapper home |
| Pipelines Running | `/dashboard/pipelines` | Pipelines list (filtered to running) |
| Pipelines Failed | `/dashboard/pipelines` | Pipelines list (filtered to failed) |
| Queries Today | `/dashboard/query` | Query Studio |
| Security Alerts | `/dashboard/security` | Security page |
| Drift Events | `/dashboard/schema` | Schema Intelligence |
| AI Autopilot Actions | `/dashboard/autopilot` | AI Autopilot |

### Number formatting

- Values ≤ 9999: Display as-is with locale separators (`toLocaleString()`).
- Values ≥ 10000: Display as `9.9k` (one decimal place, "k" suffix).
- Values ≥ 1000000: Display as `1.2M` (one decimal place, "M" suffix).
- Negative values: Not expected (counts are non-negative), but display as-is if they occur.

### Trend indicators

- `trend: "up"` with value > 0 → red alert styling (something needs attention, e.g., pipeline failures, drift events).
- `trend: "up"` with value = 0 → not shown (no trend when count is zero).
- `trend: "down"` → green positive styling (improvement, e.g., fewer failures).
- `trend: "neutral"` → no indicator shown.
- `trend: null` → no indicator shown.

## Dependencies

- Task #1 (aggregation API — provides KPI data)
- Task #3 (DashboardWidget component — reused for error/unavailable states)

## Edge cases

- **Zero value:** Displays "0" (not "—"). The distinction between "no data" and "data unavailable" is handled by `status`.
- **Very large numbers:** 1,234,567 → "1.2M". The tile should not overflow its container.
- **Missing icon:** If `icon` is null, no emoji is rendered (the label suffices).
- **Very long label or subtitle:** CSS `text-overflow: ellipsis` on a single line. The tile should not grow vertically beyond ~6 lines.
- **Rapid value changes:** Values update when the aggregation API is re-fetched (via the time-range filter or polling). No animation on value change (keeps it simple).
- **Tile not clickable in error state:** The error/unavailable state does NOT wrap in a `<Link>`, avoiding navigation to a broken module page.
- **Click tracking:** No analytics tracking in this implementation (future enhancement).

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- Tile renders with correct value, icon, and subtitle.
- Clicking a loaded tile navigates to the correct module page.
- Tile in error state shows error styling and is not clickable.
- Tile with zero shows "0".
- Tile with large value shows formatted number.

## Risk

Low. Pure frontend component work. The only integration risk is if the aggregation API's response schema changes, but the TypeScript interface provides compile-time safety.