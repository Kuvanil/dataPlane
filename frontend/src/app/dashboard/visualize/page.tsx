"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

/* ────────────────────────── Custom Table Node ────────────────────────── */
function TableNode({ data }: any) {
  const riskColors: any = {
    high: { border: "#ef4444", bg: "rgba(239,68,68,0.08)", badge: "bg-red-500/20 text-red-400" },
    medium: { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", badge: "bg-amber-500/20 text-amber-400" },
    low: { border: "#22c55e", bg: "rgba(34,197,94,0.06)", badge: "bg-emerald-500/20 text-emerald-400" },
  };
  const r = riskColors[data.risk_level] || riskColors.low;

  return (
    <div
      className="rounded-xl border-2 min-w-[220px] shadow-2xl backdrop-blur-md"
      style={{ borderColor: r.border, background: "rgba(24,24,37,0.95)" }}
    >
      <Handle type="target" position={Position.Left} style={{ background: r.border }} />
      <Handle type="source" position={Position.Right} style={{ background: r.border }} />

      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800/60" style={{ background: r.bg }}>
        <div className="flex items-center gap-2">
          <span className="text-base">{data.group === "source" ? "📤" : "📥"}</span>
          <span className="text-sm font-bold text-zinc-100 tracking-tight">{data.label}</span>
        </div>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${r.badge}`}>
          {data.risk_level?.toUpperCase()}
        </span>
      </div>

      {/* Columns */}
      <div className="px-3 py-2 flex flex-col gap-1">
        {(data.columns || []).slice(0, 8).map((col: any, i: number) => {
          const cls = col.classification || {};
          const clsColor =
            cls.level === "High" ? "text-red-400" :
            cls.level === "Medium" ? "text-amber-400" : "text-zinc-500";

          return (
            <div key={i} className="flex items-center justify-between text-[11px] px-1.5 py-0.5 rounded hover:bg-zinc-800/40 transition-colors">
              <span className="flex items-center gap-1.5">
                {col.primary_key && <span className="text-amber-400 text-[9px]">🔑</span>}
                <span className="font-mono text-zinc-300">{col.name}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-zinc-600 font-mono">{col.type}</span>
                {cls.label && <span className={`text-[9px] font-semibold ${clsColor}`}>{cls.label}</span>}
              </span>
            </div>
          );
        })}
        {(data.columns || []).length > 8 && (
          <div className="text-[10px] text-zinc-600 text-center mt-1">+{data.columns.length - 8} more columns</div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-zinc-800/40 flex items-center justify-between">
        <span className="text-[10px] text-zinc-500">{data.database}</span>
        <span className="text-[10px] text-zinc-600">{data.column_count} cols</span>
      </div>

      {data.has_issues && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold shadow-lg animate-pulse">!</div>
      )}
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

/* ────────────────────────── Main Page ────────────────────────── */
export default function VisualizePage() {
  const [graphData, setGraphData] = useState<any>(null);
  // Starts false: fetchGraph is gated on BOTH connection ids being set, so
  // an initial `true` with no auto-pickable pair left the spinner running
  // forever (dashboard_static_ui_tasks #5). The no-selection case renders
  // an explicit empty state instead.
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"all" | "source" | "target">("all");
  const [connections, setConnections] = useState<any[]>([]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const list = await api.get<{ id: number }[]>("/api/v1/connectors/");
      const data = Array.isArray(list) ? list : [];
      setConnections(data);
      // Default to the first two connectors, whatever their ids — the
      // previous magic-id-1/2 auto-pick only worked because the seed data
      // happens to use those ids, and always opened on the same pair
      // (dashboard_static_ui_tasks #4).
      if (data.length >= 2) {
        setSourceId(data[0].id);
        setTargetId(data[1].id);
      } else if (data.length === 1) {
        setSourceId(data[0].id);
      }
    } catch (err) {
      console.error("Connections fetch failed:", err);
    }
  }, []);

  const fetchGraph = useCallback(async () => {
    if (sourceId == null || targetId == null) return;
    try {
      setLoading(true);
      setGraphError(null);
      const res = await fetch(
        `${api.base}/api/v1/schema/graph?source_id=${sourceId}&target_id=${targetId}`
      );
      if (res.ok) {
        const data = await res.json();
        setGraphData(data);
      } else {
        console.error("Graph fetch failed:", res.status, res.statusText);
        setGraphError(`Failed to load graph (HTTP ${res.status})`);
        setGraphData(null);
      }
    } catch (err) {
      console.error("Graph fetch failed:", err);
      setGraphError("Failed to load graph. Please check the backend connection.");
      setGraphData(null);
    } finally {
      setLoading(false);
    }
  }, [sourceId, targetId]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  useEffect(() => {
    if (sourceId != null && targetId != null) {
      fetchGraph();
    }
  }, [sourceId, targetId, fetchGraph]);

  // Convert graph data to ReactFlow format
  const rfNodes = (graphData?.nodes || [])
    .filter((n: any) => viewMode === "all" || n.group === viewMode)
    .map((n: any) => ({
      id: n.id,
      type: "tableNode",
      position: { x: n.x || 100, y: n.y || 100 },
      data: n,
    }));

  const rfEdges = (graphData?.edges || [])
    .filter((e: any) => {
      if (viewMode === "all") return true;
      const srcNode = graphData?.nodes?.find((n: any) => n.id === e.source);
      const tgtNode = graphData?.nodes?.find((n: any) => n.id === e.target);
      return srcNode?.group === viewMode || tgtNode?.group === viewMode;
    })
    .map((e: any, i: number) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: e.style || { stroke: "#6366f1" },
      labelStyle: { fill: "#a1a1aa", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "#18181b", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }));

  const summary = graphData?.summary || {};
  const annotations = graphData?.annotations || [];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Database Topology Visualizer</h3>
          <p className="text-xs text-zinc-500">Interactive graph showing table relationships, data risks, and AI-matched mappings</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Visible labels so these read as connection pickers, not
              buttons — they were bare selects visually identical to the
              view-mode buttons beside them (dashboard_static_ui_tasks #4). */}
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            📤 Source
            <select
              value={sourceId ?? ""}
              onChange={(e) => setSourceId(e.target.value === "" ? null : Number(e.target.value))}
              className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">Select…</option>
              {connections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            📥 Target
            <select
              value={targetId ?? ""}
              onChange={(e) => setTargetId(e.target.value === "" ? null : Number(e.target.value))}
              className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">Select…</option>
              {connections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {(["all", "source", "target"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                viewMode === mode
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {mode === "all" ? "🌐 All" : mode === "source" ? "📤 Source" : "📥 Target"}
            </button>
          ))}
          <button
            onClick={fetchGraph}
            className="px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 transition-all ml-2"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Building database graph...</span>
          </div>
        </div>
      ) : sourceId == null || targetId == null ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center flex flex-col items-center gap-2">
            <span className="text-3xl">🌐</span>
            <p className="text-sm text-zinc-300 font-medium">
              Pick a source and a target connection above to build the graph.
            </p>
            {connections.length < 2 && (
              <p className="text-xs text-zinc-500">
                {connections.length === 0
                  ? "No connections available — add one on the Connectors tab first."
                  : "Only one connection exists — the graph compares two, add another on the Connectors tab."}
              </p>
            )}
          </div>
        </div>
      ) : graphError ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {graphError}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex">
          {/* Graph Canvas */}
          <div className="flex-1 relative">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={(_, node) => setSelectedNode(node.data)}
              attributionPosition="bottom-right"
              minZoom={0.3}
              maxZoom={2}
            >
              <Background color="#27272a" gap={20} size={1} />
              <Controls className="!bg-zinc-900 !border-zinc-800 !text-zinc-400 !rounded-lg !shadow-xl" />
            </ReactFlow>

            {/* Legend Overlay */}
            <div className="absolute top-4 left-4 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 backdrop-blur-md w-44 flex flex-col gap-2 shadow-2xl">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Legend</span>
              {[
                { color: "#22c55e", label: "Low Risk" },
                { color: "#f59e0b", label: "Medium Risk" },
                { color: "#ef4444", label: "High Risk / PII" },
                { color: "#8b5cf6", label: "AI Match (dashed)" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                  {item.label}
                </div>
              ))}
            </div>

            {/* Summary Cards */}
            <div className="absolute bottom-4 left-4 flex gap-2">
              {[
                { label: "Source Tables", value: summary.total_source_tables, color: "text-blue-400" },
                { label: "Target Tables", value: summary.total_target_tables, color: "text-indigo-400" },
                { label: "Matched", value: summary.matched_tables, color: "text-emerald-400" },
                { label: "Issues", value: summary.total_annotations, color: "text-red-400" },
              ].map((s, i) => (
                <div key={i} className="px-3 py-2 rounded-lg bg-zinc-900/90 border border-zinc-800 backdrop-blur-md">
                  <div className={`text-lg font-bold ${s.color}`}>{s.value ?? 0}</div>
                  <div className="text-[10px] text-zinc-500">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Side Panel: Annotations + Details */}
          <aside className="w-72 border-l border-zinc-800 bg-zinc-900/30 flex flex-col overflow-y-auto">
            <div className="p-4 border-b border-zinc-800">
              <h4 className="text-sm font-semibold text-zinc-200">Issues & Annotations</h4>
              <p className="text-[10px] text-zinc-500 mt-0.5">{annotations.length} finding(s)</p>
            </div>
            <div className="flex flex-col gap-1.5 p-3">
              {annotations.map((a: any, i: number) => (
                <div
                  key={i}
                  className={`p-2.5 rounded-lg border text-xs ${
                    a.severity === "high"
                      ? "bg-red-500/5 border-red-500/20 text-red-400"
                      : "bg-amber-500/5 border-amber-500/20 text-amber-400"
                  }`}
                >
                  <div className="font-semibold">{a.type === "error" ? "❌" : "⚠️"} {a.message}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{a.node_id}</div>
                </div>
              ))}
              {annotations.length === 0 && (
                <div className="text-xs text-zinc-500 text-center py-4">No issues detected ✅</div>
              )}
            </div>

            {/* Selected Node Detail */}
            {selectedNode && (
              <div className="border-t border-zinc-800 p-4">
                <h4 className="text-sm font-semibold text-zinc-200 mb-2">📋 {selectedNode.label}</h4>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-zinc-500">Database</span><span className="text-zinc-300">{selectedNode.database}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Group</span><span className="text-zinc-300 capitalize">{selectedNode.group}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Columns</span><span className="text-zinc-300">{selectedNode.column_count}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Risk</span><span className={selectedNode.risk_level === "high" ? "text-red-400" : selectedNode.risk_level === "medium" ? "text-amber-400" : "text-emerald-400"}>{selectedNode.risk_level?.toUpperCase()}</span></div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
