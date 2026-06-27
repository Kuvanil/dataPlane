"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DriftAlert {
  id: number;
  connection_name: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

export default function DashboardPage() {
  const [driftAlerts, setDriftAlerts] = useState<DriftAlert[]>([]);

  useEffect(() => {
    api.get<DriftAlert[]>("/api/v1/audit/?event_type=schema_drift_detected&page_size=5")
      .then(setDriftAlerts)
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 flex flex-col gap-6 overflow-y-auto">
      {/* Top Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Connected Sources", value: "5", sub: "SQLite, Postgres, MySQL, Oracle, JDBC", color: "text-blue-400", icon: "🔌" },
          { label: "Total Tables", value: "15", sub: "Across all connections", color: "text-indigo-400", icon: "📋" },
          { label: "AI Matches Found", value: "14", sub: "92% avg confidence", color: "text-violet-400", icon: "🧠" },
          { label: "PII Columns", value: "8", sub: "High risk — masking required", color: "text-red-400", icon: "🛡️" },
        ].map((m, i) => (
          <div key={i} className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-400">{m.label}</span>
              <span className="text-xl">{m.icon}</span>
            </div>
            <div className={`text-3xl font-bold ${m.color}`}>{m.value}</div>
            <div className="text-xs text-zinc-500">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Visualize Schema", icon: "🌐", href: "/dashboard/visualize", color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20 hover:border-blue-500/40" },
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

      {/* Schema Drift Alerts */}
      {driftAlerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20">
          <h3 className="font-semibold text-red-400 mb-3 flex items-center gap-2">⚠️ Schema Drift Detected</h3>
          <div className="flex flex-col gap-2">
            {driftAlerts.map((alert) => (
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
        {/* Activity Feed */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm">
          <h3 className="font-semibold mb-4 text-zinc-200">Recent Activity</h3>
          <div className="flex flex-col gap-2">
            {[
              { user: "AI Autopilot", action: "Matched 14 columns across CRM → DW with 92% confidence", time: "2m ago", type: "ai" },
              { user: "System", action: "Connected Finance_Oracle (simulated) database", time: "5m ago", type: "system" },
              { user: "AskData Bot", action: "Answered query about PII risk exposure", time: "8m ago", type: "ai" },
              { user: "Admin", action: "Generated NL2SQL report on E-Commerce schema", time: "15m ago", type: "system" },
              { user: "Security Scanner", action: "Classified 8 PII columns across 5 databases", time: "20m ago", type: "audit" },
              { user: "Schema Mapper", action: "Parsed 4 English mapping instructions", time: "30m ago", type: "system" },
            ].map((act, i) => (
              <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-zinc-800/30 border border-zinc-800/50">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${act.type === 'ai' ? 'bg-violet-500/10 text-violet-400' : act.type === 'audit' ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-700 text-zinc-300'}`}>
                    {act.type === 'ai' ? '🤖' : act.type === 'audit' ? '🛡️' : '⚙️'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{act.action}</div>
                    <div className="text-xs text-zinc-500">{act.user}</div>
                  </div>
                </div>
                <span className="text-xs text-zinc-500">{act.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Connection Health */}
        <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm flex flex-col">
          <h3 className="font-semibold mb-4 text-zinc-200">Connection Health</h3>
          <div className="flex flex-col gap-3 flex-1">
            {[
              { name: "CRM Source", type: "sqlite", icon: "💾", health: 85, status: "Connected" },
              { name: "Data Warehouse", type: "sqlite", icon: "💾", health: 80, status: "Connected" },
              { name: "E-Commerce", type: "mysql", icon: "🐬", health: 75, status: "Connected" },
              { name: "Finance Oracle", type: "oracle", icon: "🏛️", health: 90, status: "Simulated" },
              { name: "HR Postgres", type: "postgres", icon: "🐘", health: 88, status: "Connected" },
            ].map((db, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
                <span className="text-lg">{db.icon}</span>
                <div className="flex-1">
                  <div className="text-xs font-medium text-zinc-200">{db.name}</div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${db.health}%` }} />
                  </div>
                </div>
                <span className="text-[10px] text-emerald-400 font-semibold">{db.health}%</span>
              </div>
            ))}
          </div>
          <Link href="/dashboard/visualize" className="mt-4 w-full py-2 bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl text-sm font-semibold text-center block">
            Open Visualizer →
          </Link>
        </div>
      </div>
    </div>
  );
}
