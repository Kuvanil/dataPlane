"use client";
import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

interface AuditEvent {
  id: number;
  event_type: string;
  actor: string;
  connection_id: number | null;
  connection_name: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

interface AuditSummary {
  total: number;
  by_event_type: Record<string, { total: number; success: number; failure: number; warning: number }>;
}

const EVENT_LABELS: Record<string, string> = {
  query_executed: "Query Executed",
  pipeline_run: "Pipeline Run",
  connector_created: "Connector Created",
  connector_deleted: "Connector Deleted",
  schema_classified: "Schema Classified",
  schema_drift_detected: "Schema Drift",
  autopilot_run: "Autopilot Run",
};

const STATUS_STYLES: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failure: "bg-red-500/10 text-red-400 border-red-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const EVENT_ICONS: Record<string, string> = {
  query_executed: "💬",
  pipeline_run: "🔗",
  connector_created: "🔌",
  connector_deleted: "🗑️",
  schema_classified: "🛡️",
  schema_drift_detected: "⚠️",
  autopilot_run: "⚙️",
};

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "50" });
      if (filterType) params.set("event_type", filterType);
      if (filterStatus) params.set("status", filterStatus);
      const data = await api.get<AuditEvent[]>(`/api/v1/audit/?${params}`);
      setEvents(data);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterStatus]);

  useEffect(() => {
    fetchEvents();
    api.get<AuditSummary>("/api/v1/audit/summary").then(setSummary).catch(() => {});
  }, [fetchEvents]);

  const summaryCards = [
    { label: "Total Events", value: summary?.total ?? 0, icon: "📋", color: "text-blue-400" },
    { label: "Queries Run", value: summary?.by_event_type?.query_executed?.total ?? 0, icon: "💬", color: "text-violet-400" },
    { label: "Pipelines Run", value: summary?.by_event_type?.pipeline_run?.total ?? 0, icon: "🔗", color: "text-indigo-400" },
    { label: "Failures", value: Object.values(summary?.by_event_type ?? {}).reduce((acc, v) => acc + (v.failure || 0), 0), icon: "❌", color: "text-red-400" },
  ];

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((c, i) => (
          <div key={i} className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">{c.label}</span>
              <span className="text-xl">{c.icon}</span>
            </div>
            <div className={`text-3xl font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
        >
          <option value="">All Event Types</option>
          {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
        >
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="warning">Warning</option>
        </select>
        <button onClick={fetchEvents} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          Refresh
        </button>
        <span className="text-xs text-zinc-500 ml-auto">{events.length} events</span>
      </div>

      {/* Events Table */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading audit events...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">No audit events found. Actions like running queries, pipelines, and connectors will appear here.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs">
                <th className="p-4">Timestamp</th>
                <th className="p-4">Event</th>
                <th className="p-4">Connection</th>
                <th className="p-4">Status</th>
                <th className="p-4">Duration</th>
                <th className="p-4">Actor</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <React.Fragment key={ev.id}>
                  <tr
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  >
                    <td className="p-4 text-zinc-400 font-mono text-xs whitespace-nowrap">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span>{EVENT_ICONS[ev.event_type] ?? "📌"}</span>
                        <span className="text-zinc-200 font-medium">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                      </div>
                    </td>
                    <td className="p-4 text-zinc-400">{ev.connection_name ?? "—"}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[ev.status] ?? ""}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-400 text-xs">
                      {ev.duration_ms != null ? `${ev.duration_ms}ms` : "—"}
                    </td>
                    <td className="p-4 text-zinc-500 text-xs">{ev.actor}</td>
                  </tr>
                  {expandedId === ev.id && ev.payload && Object.keys(ev.payload).length > 0 && (
                    <tr className="border-b border-zinc-800/50 bg-zinc-900/80">
                      <td colSpan={6} className="px-6 py-3">
                        <pre className="text-xs text-zinc-300 font-mono overflow-x-auto">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {events.length >= 50 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg disabled:opacity-40">
            Previous
          </button>
          <span className="text-xs text-zinc-400">Page {page}</span>
          <button onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
