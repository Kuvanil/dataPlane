# Task #5 — Activity Feed Widget (DASH-T5)

**TRD reference:** FR3 (recent activity feed of latest N events across modules), FR5 (drill-through to relevant detail view).

**Current state:** The `dashboard_static_ui_tasks/` work (#2) replaced fabricated feed entries with real data from `GET /audit/?page_size=8`, showing event_type, actor, relative timestamps, and failure tinting. However:
- Feed items are not enriched with module-context information (no `module` categorization, no deep link URL).
- There is no truncation or "view all" link for long feeds.
- There is no polling/auto-refresh for near-real-time updates.
- The feed does not use the unified aggregation API (Task #1).

## Scope

Build the activity feed widget that consumes the `feed` array from the aggregation API and renders enriched, clickable feed items.

### Component — `frontend/src/app/dashboard/components/ActivityFeed.tsx` (new)

```tsx
interface FeedItemData {
  id: number;
  event_type: string;
  actor: string;
  module: string;
  summary: string;
  status: string;
  created_at: string;
  link_url: string | null;
}

interface ActivityFeedProps {
  items: FeedItemData[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

const MODULE_ICONS: Record<string, string> = {
  connectors: "🔌",
  pipelines: "▶️",
  mappings: "🔗",
  schema_intel: "📊",
  security: "🔒",
  audit: "📋",
  autopilot: "🤖",
  query: "💡",
  system: "⚙️",
};

const EVENT_TYPE_BUCKETS: Record<string, { icon: string; label: string }> = {
  connector_created: { icon: "➕", label: "Connector added" },
  connector_deleted: { icon: "🗑️", label: "Connector removed" },
  connector_tested: { icon: "✅", label: "Connection tested" },
  mapping_created: { icon: "🔗", label: "Mapping created" },
  mapping_published: { icon: "📢", label: "Mapping published" },
  pipeline_created: { icon: "📦", label: "Pipeline created" },
  pipeline_run_started: { icon: "▶️", label: "Pipeline run started" },
  pipeline_run_succeeded: { icon: "✅", label: "Pipeline run succeeded" },
  pipeline_run_failed: { icon: "❌", label: "Pipeline run failed" },
  pipeline_run_retrying: { icon: "🔄", label: "Pipeline run retrying" },
  schema_scanned: { icon: "📡", label: "Schema scanned" },
  schema_drift_detected: { icon: "⚠️", label: "Drift detected" },
  schema_classified: { icon: "🏷️", label: "Schema classified" },
  security_alert: { icon: "🚨", label: "Security alert" },
  autopilot_action: { icon: "🤖", label: "AI Autopilot action" },
  query_executed: { icon: "💡", label: "Query executed" },
};

function getEventMeta(event_type: string) {
  return EVENT_TYPE_BUCKETS[event_type] || { icon: "📄", label: event_type };
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityFeed({ items, isLoading, isError, onRetry }: ActivityFeedProps) {
  const MAX_VISIBLE_ITEMS = 8;

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const hasMore = items.length > MAX_VISIBLE_ITEMS;

  return (
    <DashboardWidget
      title="Recent Activity"
      icon="📋"
      isLoading={isLoading}
      isEmpty={!isLoading && items.length === 0}
      emptyMessage="No activity yet — connect a source or create a mapping."
      isError={isError}
      onRetry={onRetry}
    >
      <ul className="activity-feed divide-y">
        {visibleItems.map((item) => {
          const meta = getEventMeta(item.event_type);
          const isFailure = item.status === "failed" || item.status === "error";
          return (
            <li key={item.id} className={`py-2 ${isFailure ? "bg-red-50" : ""}`}>
              {item.link_url ? (
                <Link href={item.link_url} className="flex items-start gap-2 hover:bg-gray-50 p-1 rounded -mx-1">
                  <span className="mt-0.5" role="img" aria-hidden="true">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.summary || meta.label}</p>
                    <p className="text-xs text-gray-500">
                      {item.actor} · {formatRelativeTime(item.created_at)}
                    </p>
                  </div>
                  {isFailure && <span className="text-red-500 text-xs mt-1">Failed</span>}
                </Link>
              ) : (
                <div className="flex items-start gap-2 p-1">
                  <span className="mt-0.5" role="img" aria-hidden="true">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.summary || meta.label}</p>
                    <p className="text-xs text-gray-500">
                      {item.actor} · {formatRelativeTime(item.created_at)}
                    </p>
                  </div>
                  {isFailure && <span className="text-red-500 text-xs mt-1">Failed</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <Link href="/dashboard/audit" className="block text-center text-sm text-blue-600 hover:underline py-2">
          View all activity →
        </Link>
      )}
    </DashboardWidget>
  );
}
```

### Feed enrichment logic (backend — in `dashboard_service.py` from Task #1)

The `_to_feed_item()` helper maps an `AuditLog` row to a `FeedItem`:

```python
EVENT_TYPE_MODULE_MAP = {
    "connector_": "connectors",
    "pipeline_": "pipelines",
    "mapping_": "mappings",
    "schema_": "schema_intel",
    "security_": "security",
    "autopilot_": "autopilot",
    "query_": "query",
    "ai_": "autopilot",
    "auth_": "system",
    "system_": "system",
}

def _to_feed_item(self, event: AuditLog) -> FeedItem:
    # Derive module from event_type prefix
    module = "system"
    for prefix, mod in EVENT_TYPE_MODULE_MAP.items():
        if event.event_type.startswith(prefix):
            module = mod
            break

    # Build human-readable summary
    summary = event.event_type.replace("_", " ").title()
    if event.connection_name:
        summary = f"{summary} — {event.connection_name}"

    # Build deep link
    link_url = self._module_link_url(module, event)

    return FeedItem(
        id=event.id,
        event_type=event.event_type,
        actor=event.actor or "system",
        module=module,
        summary=summary,
        status=event.status or "completed",
        created_at=event.created_at,
        link_url=link_url,
    )

def _module_link_url(self, module: str, event: AuditLog) -> str | None:
    links = {
        "connectors": "/dashboard/connectors",
        "pipelines": f"/dashboard/pipelines?highlight={event.connection_name or ''}",
        "mappings": "/dashboard/schema-mapper",
        "schema_intel": "/dashboard/schema",
        "security": "/dashboard/security",
        "autopilot": "/dashboard/autopilot",
        "query": "/dashboard/query",
    }
    return links.get(module)
```

### Real-time updates (polling)

Add a polling mechanism to the feed for near-real-time updates:

```tsx
// In the dashboard page
const POLL_INTERVAL_MS = 30_000; // 30 seconds

useEffect(() => {
  const interval = setInterval(() => {
    summary.refetch();
  }, POLL_INTERVAL_MS);
  return () => clearInterval(interval);
}, [summary.refetch]);
```

The polling interval is:
- 30s by default (configurable via environment variable `NEXT_PUBLIC_DASHBOARD_POLL_INTERVAL_MS`)
- Disabled when the page is backgrounded (use `visibilitychange` to pause/resume)
- Disabled when any widget is in error state (avoid futile retries)

## Dependencies

- Task #1 (aggregation API — provides feed data)
- Task #3 (DashboardWidget — wraps the feed with loading/empty/error states)

## Edge cases

- **Empty feed:** Shows "No activity yet — connect a source or create a mapping." with an icon.
- **Very long feed:** Truncated to 8 visible items with a "View all activity →" link to the audit trail page.
- **Very long event summaries:** CSS `truncate` with `min-width: 0` on the flex container prevents overflow.
- **Unknown event_type:** Falls back to `{ icon: "📄", label: event_type }` — never crashes on unrecognized types.
- **Relative time drift:** `formatRelativeTime` is computed on every render via `Date.now()`. A feed item from 61 seconds ago shows "1m ago", not "just now". Items older than 30 days show a date string instead of relative time.
- **Rapid polling:**
  - If the user is on a slow connection, the polling interval may fire before the previous request completes. Mitigation: skip polling if `isLoading` is true.
  - If the page is backgrounded (user switches tabs), polling pauses via `visibilitychange` listener.
- **Feed item with null link_url:** Renders without a `<Link>` wrapper — the item is still visible but not clickable.
- **Failure tinting:** Items with `status: "failed"` or `status: "error"` get a light red background (`bg-red-50`) and a "Failed" badge. All other statuses render normally.

## Verify

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- Feed renders items in reverse-chronological order.
- Each item shows icon, summary, actor, relative time, and link.
- Items with failure status are tinted red.
- Empty feed shows the empty state message.
- Feed with >8 items shows "View all activity" link.
- Polling fetches new data every 30s.

## Risk

Low. The feed component is a pure presentational component. The enrichment logic is a simple string/prefix match on the backend. Polling is a standard pattern with clear edge case handling.