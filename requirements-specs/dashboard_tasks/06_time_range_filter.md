# Task #6 — Time-Range Filter (DASH-T6)

**TRD reference:** FR4 (filter all time-sensitive widgets by 24h, 7d, or 30d), AC2 (selecting "7d" re-queries all widgets).

**Current state:** No time-range filter exists anywhere. The `dashboard_static_ui_tasks/` work always fetches all-time data from individual endpoints.

## Scope

Add a segmented control time-range filter to the dashboard page header. The filter passes the selected range to the aggregation API (Task #1) via the `?range=` query parameter, causing all time-sensitive widgets to re-fetch data for the selected period.

### Component — `frontend/src/app/dashboard/components/TimeRangeFilter.tsx` (new)

```tsx
type TimeRange = "24h" | "7d" | "30d";

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  disabled?: boolean;
}

const OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

/**
 * TimeRangeFilter — Segmented control for selecting the dashboard time range.
 *
 * Edge cases:
 * - Disabled state: Grayed out during loading to prevent rapid switching
 * - Invalid value: Falls back to "7d" (the default)
 * - Keyboard accessible: Native radio-button pattern with ARIA role
 */
export function TimeRangeFilter({ value, onChange, disabled }: TimeRangeFilterProps) {
  const safeValue = OPTIONS.some((o) => o.value === value) ? value : "7d";

  return (
    <div className="time-range-filter flex rounded-lg border border-gray-300 overflow-hidden" role="radiogroup" aria-label="Time range">
      {OPTIONS.map((opt) => {
        const isSelected = safeValue === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              isSelected
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-100"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

### Integration in `dashboard/page.tsx`

```tsx
export default function DashboardPage() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");

  const summary = useWidgetData(
    () => api.get(`/api/v1/dashboard/summary?range=${range}`),
    (data) => data.kpis.length === 0 && data.feed.length === 0,
    [range],
  );

  return (
    <div>
      <div className="dashboard-header flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <TimeRangeFilter value={range} onChange={setRange} disabled={summary.isLoading} />
      </div>

      <div className="kpi-grid ...">
        {/* KPI tiles from Task #4 */}
      </div>

      <div className="feed-section mt-6">
        {/* Activity feed from Task #5 */}
      </div>
    </div>
  );
}
```

### Backend range handling (in `dashboard_service.py` from Task #1)

The aggregation service computes a `range_start` datetime from the range parameter and applies it to time-sensitive queries:

```python
from datetime import datetime, timedelta

RANGE_DELTAS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}

def _get_range_start(self, range: str) -> datetime:
    delta = RANGE_DELTAS.get(range, timedelta(days=7))
    return datetime.utcnow() - delta
```

Time-sensitive queries (audit events, pipeline runs, autopilot actions, query history) filter by `created_at >= range_start`. Non-time-sensitive queries (connector count, total mappings) return all-time counts regardless of the range.

### Range persistence

- The selected range is stored in `localStorage` as `dashboard_time_range` so it survives page refreshes.
- On mount, read from `localStorage`; fall back to `"7d"` if not set.
- On change, write to `localStorage`.

```tsx
// In the dashboard page
const [range, setRange] = useState<"24h" | "7d" | "30d">(() => {
  if (typeof window !== "undefined") {
    return (localStorage.getItem("dashboard_time_range") as "24h" | "7d" | "30d") || "7d";
  }
  return "7d";
});

const handleRangeChange = (newRange: "24h" | "7d" | "30d") => {
  setRange(newRange);
  localStorage.setItem("dashboard_time_range", newRange);
};
```

## Dependencies

- Task #1 (aggregation API accepts `?range=` parameter)
- Task #4 (KPI tiles need to re-fetch when range changes)
- Task #5 (activity feed needs to re-fetch when range changes)

## Edge cases

- **Rapid switching:** User clicks 24h → 7d → 30d in quick succession. The `useWidgetData` hook's `useCallback` dependency on `[range]` ensures each range change triggers a new fetch. However, a slow response from a previous range could resolve after switching, overwriting the new range's data. Mitigation: Use an abort controller to cancel in-flight requests when the range changes:
  ```tsx
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [range]);
  ```
- **Range with no data:** If no data exists for the selected range (e.g. a fresh install with no audit events in the last 24h), all time-sensitive tiles show `0` and the feed shows the empty state. This is handled by the individual widget states from Task #3/Task #4.
- **Default selection:** `7d` is the default (as specified in TRD §11 Technical Notes). It provides enough data for a meaningful overview without being overwhelming.
- **Invalid range value:** If an invalid value is somehow stored in `localStorage` (e.g. from a future version), the fallback to `"7d"` handles it gracefully.
- **Server-side validation:** The aggregation API's `regex` validator on the `range` query param rejects anything other than `24h`, `7d`, `30d` with a 422. The frontend only sends valid values, so this is a defense-in-depth measure.
- **Disabled during loading:** The filter buttons are disabled while `isLoading` is true, preventing the user from switching ranges while a fetch is in progress. The `disabled` state is visually indicated with `opacity-50` and `cursor-not-allowed`.

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- Filter renders with three options: 24h / 7 days / 30 days.
- Default selection is "7 days" (highlighted in blue).
- Clicking a different option triggers a re-fetch and the selected option updates.
- The filter is disabled during loading.
- The selection persists across page refreshes (localStorage).
- Rapid switching does not cause stale data to overwrite fresh data (abort controller).

## Risk

Low. The time-range filter is a standard UI pattern with well-understood edge cases. The abort controller mitigation for rapid switching adds a small amount of complexity but prevents a real class of race-condition bugs.