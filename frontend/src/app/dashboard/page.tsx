"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ActivityFeed } from "./components/ActivityFeed";
import { DashboardWidget } from "./components/DashboardWidget";
import { KPITile } from "./components/KPITile";
import { TimeRangeFilter } from "./components/TimeRangeFilter";
import { useWidgetData } from "./hooks/useWidgetData";
import type { DashboardSummary, TimeRange } from "./types";

interface DriftAlert {
  id: number;
  connection_name: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

interface Connector {
  id: number;
  name: string;
  type: string;
}

// dashboard_static_ui_tasks #3: per-connector connectivity, verified live
// via POST /connectors/{id}/test — not a fabricated health percentage.
type TestStatus = "testing" | "connected" | "failed";

const TYPE_ICONS: Record<string, string> = {
  sqlite: "💾",
  postgres: "🐘",
  mysql: "🐬",
  oracle: "🏛️",
  jdbc: "🔌",
};

const RANGE_STORAGE_KEY = "dashboard_time_range";

const POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_DASHBOARD_POLL_INTERVAL_MS ?? 30_000,
);

// While the summary loads, render 8 skeleton tiles (the API's tile count)
// so the grid doesn't collapse and reflow on first paint.
const SKELETON_TILE_COUNT = 8;

export default function DashboardPage() {
  const [range, setRange] = useState<TimeRange>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(RANGE_STORAGE_KEY);
      if (stored === "24h" || stored === "7d" || stored === "30d") return stored;
    }
    return "7d";
  });

  // Unified aggregation API (dashboard_tasks #1) — KPI tiles + feed in one
  // payload, re-fetched whenever the time range changes (#6).
  const summary = useWidgetData<DashboardSummary>(
    (signal) => api.get<DashboardSummary>(`/api/v1/dashboard/summary?range=${range}`, { signal }),
    [range],
  );

  // Drift alert details and connection health are their own isolated
  // widgets (dashboard_tasks #3) — each fails alone, not the whole page.
  const drift = useWidgetData<DriftAlert[]>(
    (signal) => api.get<DriftAlert[]>("/api/v1/audit/?event_type=schema_drift_detected&page_size=5", { signal }),
    [],
  );

  const connectors = useWidgetData<Connector[]>(
    (signal) => api.get<Connector[]>("/api/v1/connectors/", { signal }),
    [],
  );
  const [testResults, setTestResults] = useState<Record<number, TestStatus>>({});

  // Probe each connector; rows without a result yet render as "testing"
  // (the render fallback below), so no synchronous state seeding needed.
  useEffect(() => {
    const list = connectors.data;
    if (!list) return;
    list.forEach((c) => {
      api
        .post<{ status: string }>(`/api/v1/connectors/${c.id}/test`, {})
        .then((r) =>
          setTestResults((prev) => ({
            ...prev,
            [c.id]: r.status === "connected" ? "connected" : "failed",
          })),
        )
        .catch(() => setTestResults((prev) => ({ ...prev, [c.id]: "failed" })));
    });
  }, [connectors.data]);

  // Near-real-time refresh (dashboard_tasks #5): poll the aggregation API,
  // pausing while the tab is hidden, a fetch is in flight, or the last
  // fetch errored (no futile retry loops — the user has a Retry button).
  const { refetch, isLoading, isError } = summary;
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden || isLoading || isError) return;
      refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refetch, isLoading, isError]);

  const handleRangeChange = (next: TimeRange) => {
    setRange(next);
    localStorage.setItem(RANGE_STORAGE_KEY, next);
  };

  return (
    <div className="p-6 flex flex-col gap-6 overflow-y-auto">
      {/* Header: title + time-range filter (dashboard_tasks #6) */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
        <TimeRangeFilter value={range} onChange={handleRangeChange} disabled={summary.isLoading} />
      </div>

      {/* KPI tiles with drill-through (dashboard_tasks #4) */}
      {summary.isError ? (
        <div className="p-5 rounded-2xl bg-zinc-900/50 border border-red-500/30 backdrop-blur-sm">
          <p className="text-sm text-red-400">
            Failed to load dashboard summary{summary.errorMessage ? ` — ${summary.errorMessage}` : ""}.
          </p>
          <button
            onClick={summary.refetch}
            className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summary.data
            ? summary.data.kpis.map((tile) => <KPITile key={tile.label} tile={tile} />)
            : Array.from({ length: SKELETON_TILE_COUNT }, (_, i) => (
                <KPITile
                  key={i}
                  isLoading
                  tile={{ label: "", value: 0, link_url: "", module: "", status: "loaded" }}
                />
              ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Visualize Schema", icon: "🌐", href: "/dashboard/visualize/topology", color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20 hover:border-blue-500/40" },
          { label: "Query Studio", icon: "💬", href: "/dashboard/query-studio", color: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 hover:border-emerald-500/40" },
          { label: "AskData Bot", icon: "🤖", href: "/dashboard/askdata", color: "from-violet-500/10 to-purple-500/10 border-violet-500/20 hover:border-violet-500/40" },
          { label: "Schema Mapper", icon: "🗺️", href: "/dashboard/schema-mapper", color: "from-amber-500/10 to-orange-500/10 border-amber-500/20 hover:border-amber-500/40" },
        ].map((a, i) => (
          <Link key={i} href={a.href} className={`p-4 rounded-xl bg-gradient-to-br ${a.color} border backdrop-blur-sm flex items-center gap-3 transition-all group`}>
            <span className="text-2xl group-hover:scale-110 transition-transform">{a.icon}</span>
            <span className="text-sm font-semibold text-zinc-200">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Schema Drift Alerts — details beyond the KPI count. Hidden when
          empty or failed (the Drift Events tile still reports the count). */}
      {!drift.isError && (drift.data?.length ?? 0) > 0 && (
        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20">
          <h3 className="font-semibold text-red-400 mb-3 flex items-center gap-2">⚠️ Schema Drift Detected</h3>
          <div className="flex flex-col gap-2">
            {drift.data!.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                <div>
                  <span className="text-sm font-medium text-zinc-200">{alert.connection_name ?? "Unknown connection"}</span>
                  <span className="text-xs text-zinc-500 ml-2">schema changed</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">{new Date(alert.created_at).toLocaleString()}</span>
                  <Link href="/dashboard/schema" className="text-xs text-blue-400 hover:text-blue-300">Inspect →</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed — from the aggregation API (dashboard_tasks #5) */}
        <ActivityFeed
          className="lg:col-span-2"
          items={summary.data?.feed ?? []}
          isLoading={summary.isLoading && !summary.data}
          isError={summary.isError}
          errorMessage={summary.errorMessage}
          onRetry={summary.refetch}
        />

        {/* Connection Health — real connectors, live connectivity probes
            (dashboard_static_ui_tasks #3), now an isolated widget. */}
        <DashboardWidget
          title="Connection Health"
          isLoading={connectors.isLoading}
          isError={connectors.isError}
          errorMessage={connectors.errorMessage}
          onRetry={connectors.refetch}
          isEmpty={(connectors.data?.length ?? 0) === 0}
          emptyMessage="No connections yet."
          emptyAction={{ label: "Add one", href: "/dashboard/connectors" }}
        >
          <div className="flex flex-col gap-3">
            {connectors.data?.map((db) => {
              const status = testResults[db.id] ?? "testing";
              return (
                <div key={db.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
                  <span className="text-lg">{TYPE_ICONS[db.type] ?? "🔌"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-200 truncate">{db.name}</div>
                    <div className="text-[10px] text-zinc-500">{db.type}</div>
                  </div>
                  {status === "testing" ? (
                    <span className="text-[10px] text-zinc-500 font-semibold flex items-center gap-1">
                      <span className="w-2.5 h-2.5 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
                      testing
                    </span>
                  ) : status === "connected" ? (
                    <span className="text-[10px] text-emerald-400 font-semibold">● Connected</span>
                  ) : (
                    <span className="text-[10px] text-red-400 font-semibold">● Failed</span>
                  )}
                </div>
              );
            })}
          </div>
          <Link href="/dashboard/visualize/topology" className="mt-4 w-full py-2 bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl text-sm font-semibold text-center block">
            Open Visualizer →
          </Link>
        </DashboardWidget>
      </div>
    </div>
  );
}
