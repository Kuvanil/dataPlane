# Task #3 — Widget Framework with Isolated States (DASH-T3)

**TRD reference:** FR6 (loading/empty/error states per widget), Reliability NFR (individual widget failure is isolated, auto-retry on transient errors).

**Current state:** The `dashboard_static_ui_tasks/` work added basic loading/error states to `dashboard/page.tsx`, but they are not per-widget isolated. One failed fetch can still degrade the whole page (e.g. the connector test call timing out blocks the entire page render below the fold). Widgets share a single `loading` state and a single `error` state.

## Scope

Create a reusable `DashboardWidget` wrapper component that manages its own loading/empty/error states independently. Each widget on the dashboard page wraps its content in this component so one widget's failure does not affect others.

### Component — `frontend/src/app/dashboard/components/DashboardWidget.tsx` (new)

```tsx
interface DashboardWidgetProps {
  title: string;
  icon?: string;
  isLoading: boolean;
  isEmpty: boolean;
  isError: boolean;
  errorMessage?: string;
  emptyMessage?: string;
  emptyAction?: { label: string; href: string };
  onRetry?: () => void;
  linkUrl?: string;
  children: React.ReactNode;
}

/**
 * DashboardWidget — self-contained widget wrapper with isolated states.
 *
 * States:
 * - Loading: Skeleton shimmer placeholder
 * - Empty: Friendly message + optional action link
 * - Error: Error message + retry button (if onRetry provided)
 * - Loaded: Children rendered as-is
 *
 * Edge cases:
 * - Multiple states cannot be active simultaneously (loading > error > empty > content)
 * - onRetry is optional; if not provided, error state shows message only
 * - linkUrl wraps the entire widget header in a Link for drill-through
 */
export function DashboardWidget({
  title, icon, isLoading, isEmpty, isError, errorMessage,
  emptyMessage, emptyAction, onRetry, linkUrl, children,
}: DashboardWidgetProps) {
  if (isLoading) {
    return (
      <div className="dashboard-widget">
        <div className="widget-header">{icon} {title}</div>
        <div className="widget-body">
          <div className="skeleton-line w-3/4 h-4 mb-2 bg-gray-200 rounded animate-pulse" />
          <div className="skeleton-line w-1/2 h-4 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="dashboard-widget border-red-200 bg-red-50">
        <div className="widget-header">{icon} {title}</div>
        <div className="widget-body text-red-700">
          <p>{errorMessage || "Failed to load data."}</p>
          {onRetry && (
            <button onClick={onRetry} className="btn btn-sm btn-outline mt-2">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="dashboard-widget">
        <div className="widget-header">{icon} {title}</div>
        <div className="widget-body text-gray-500">
          <p>{emptyMessage || "No data available."}</p>
          {emptyAction && (
            <Link href={emptyAction.href} className="text-blue-600 hover:underline mt-1 inline-block">
              {emptyAction.label}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-widget">
      {linkUrl ? (
        <Link href={linkUrl} className="widget-header hover:underline">
          {icon} {title}
        </Link>
      ) : (
        <div className="widget-header">{icon} {title}</div>
      )}
      <div className="widget-body">
        {children}
      </div>
    </div>
  );
}
```

### Custom hook — `frontend/src/app/dashboard/hooks/useWidgetData.ts` (new)

```ts
interface UseWidgetDataResult<T> {
  data: T | null;
  isLoading: boolean;
  isEmpty: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  refetch: () => void;
}

function useWidgetData<T>(
  fetcher: () => Promise<T>,
  isEmptyCheck: (data: T) => boolean,
  deps: unknown[] = [],
): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(undefined);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setIsError(true);
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, deps);

  useEffect(() => { fetch(); }, [fetch]);

  return {
    data,
    isLoading,
    isEmpty: !isLoading && !isError && data !== null && isEmptyCheck(data),
    isError,
    errorMessage,
    refetch: fetch,
  };
}
```

### Integration in `dashboard/page.tsx`

Refactor the existing page to use `DashboardWidget` + `useWidgetData` for each widget section:

```tsx
export default function DashboardPage() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");

  const summary = useWidgetData(
    () => api.get(`/api/v1/dashboard/summary?range=${range}`),
    (data) => data.kpis.length === 0 && data.feed.length === 0,
    [range],
  );

  return (
    <div className="dashboard-grid">
      {/* KPI Tiles */}
      {summary.data?.kpis.map((kpi) => (
        <DashboardWidget
          key={kpi.label}
          title={kpi.label}
          icon={kpi.icon}
          isLoading={summary.isLoading}
          isEmpty={false}
          isError={kpi.status === "error"}
          errorMessage={kpi.error_message}
          linkUrl={kpi.link_url}
        >
          <div className="kpi-value">{kpi.value.toLocaleString()}</div>
          {kpi.subtitle && <div className="kpi-subtitle">{kpi.subtitle}</div>}
        </DashboardWidget>
      ))}

      {/* Activity Feed */}
      <DashboardWidget
        title="Recent Activity"
        isLoading={summary.isLoading}
        isEmpty={summary.data?.feed.length === 0}
        emptyMessage="No activity yet — connect a source or create a mapping."
        isError={false}
      >
        {summary.data?.feed.map((item) => (
          <FeedItemRow key={item.id} item={item} />
        ))}
      </DashboardWidget>
    </div>
  );
}
```

## Dependencies

- Task #1 (aggregation API response schema)
- Existing `api` client from `@/lib/api`
- Tailwind CSS (already configured for skeleton animations)

## Edge cases

- **Loading → error transition:** If loading succeeds but data is empty, show empty state (not error). Priority: loading > error > empty > content.
- **Rapid success/failure cycling:** `useWidgetData` resets state on each `fetch` call. A sequence of fetch → error → fetch → success correctly transitions through all states.
- **Retry after error:** Clicking "Retry" calls `refetch()` which re-runs the fetcher and resets all states.
- **Multiple widgets, one is slow:** Each widget manages its own `isLoading` state independently. A slow widget shows its skeleton while other widgets render their content.
- **Widget with no data source (unavailable module):** The aggregation API returns `status: "unavailable"` for that tile; the widget treats this as an error state with a message like "Module not available".
- **Keyboard accessibility:** The retry button is a native `<button>`. The widget header, when wrapped in a `Link`, is keyboard-focusable. Skeleton loaders have `aria-hidden="true"`.

## Verify

```bash
cd frontend && npx tsc --noEmit    # TypeScript compilation
cd frontend && npx next build       # Production build
```

- Skeleton shimmer renders during loading.
- Error state shows message + retry button.
- Empty state shows friendly message + optional action link.
- Content renders normally in the happy path.
- One widget in error state does not affect other widgets.

## Risk

Low. Pure frontend work — no data model or API changes. The component is additive and does not modify any existing widget logic until the refactor step.