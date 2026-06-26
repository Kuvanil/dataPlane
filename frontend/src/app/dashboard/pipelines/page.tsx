"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MarkerType } from "reactflow";
import "reactflow/dist/style.css";

// ===== Types =====

interface Connector {
  id: number;
  name: string;
  type: string;
  config: any;
}

type PipelineNodeType = "source" | "ai_matcher" | "mask" | "target";

interface PipelineNodeData {
  label: string;
  nodeType: PipelineNodeType;
  config?: { connection_id?: number };
}

interface ColumnMatch {
  source: string;
  target: string;
  confidence: number;
  reason: string;
}

interface TableMapping {
  source_table: string;
  target_table: string;
  confidence: number;
  details: {
    matches: ColumnMatch[];
    source: string;
    target: string;
    ai_processed: boolean;
  };
}

interface ExecuteResult {
  status: "success";
  source: string;
  target: string;
  source_connection_id: number;
  target_connection_id: number;
  table_mappings: TableMapping[];
  unmatched_source: string[];
  unmatched_target: string[];
  migration_sql: {
    ddl: string[];
    dml: string[];
    warnings: string[];
    total_statements: number;
  };
}

// ===== Constants =====

const BASE_STYLE = {
  background: "#1e1e2e",
  color: "#cdd6f4",
  borderRadius: "12px",
  padding: "10px",
  borderWidth: "1px",
  borderStyle: "solid",
};

const NODE_STYLE: Record<PipelineNodeType, React.CSSProperties> = {
  source: { ...BASE_STYLE, borderColor: "#89b4fa" },
  ai_matcher: { ...BASE_STYLE, borderColor: "#f38ba8" },
  mask: { ...BASE_STYLE, borderColor: "#a6e3a1" },
  target: { ...BASE_STYLE, borderColor: "#f9e2af" },
};

const SELECTED_STYLE = {
  outline: "2px solid #a78bfa",
  outlineOffset: "2px",
};

function buildLabel(nodeType: PipelineNodeType, connectionName?: string): string {
  switch (nodeType) {
    case "source":
      return connectionName ? `🔌 Source: ${connectionName}` : "🔌 Source: Not Configured";
    case "target":
      return connectionName ? `❄️ Target: ${connectionName}` : "❄️ Target: Not Configured";
    case "ai_matcher":
      return "🧠 AI Matcher (Auto)";
    case "mask":
      return "🛡️ Mask: PII Filter";
  }
}

function confidenceColor(conf: number): string {
  if (conf >= 80) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (conf >= 50) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-rose-500/15 text-rose-300 border-rose-500/30";
}

function confidenceTextColor(conf: number): string {
  if (conf >= 80) return "text-emerald-300";
  if (conf >= 50) return "text-amber-300";
  return "text-rose-300";
}

// ===== Initial state =====

const initialNodesState: any[] = [
  {
    id: "1",
    data: { label: buildLabel("source"), nodeType: "source", config: {} },
    position: { x: 50, y: 150 },
    style: NODE_STYLE.source,
  },
  {
    id: "2",
    data: { label: buildLabel("ai_matcher"), nodeType: "ai_matcher" },
    position: { x: 250, y: 150 },
    style: NODE_STYLE.ai_matcher,
  },
  {
    id: "3",
    data: { label: buildLabel("mask"), nodeType: "mask" },
    position: { x: 450, y: 100 },
    style: NODE_STYLE.mask,
  },
  {
    id: "4",
    data: { label: buildLabel("target"), nodeType: "target", config: {} },
    position: { x: 650, y: 150 },
    style: NODE_STYLE.target,
  },
];

const initialEdgesState = [
  { id: "e1-2", source: "1", target: "2", animated: true },
  { id: "e2-3", source: "2", target: "3", markerEnd: { type: MarkerType.Arrow } },
  { id: "e2-4", source: "2", target: "4", markerEnd: { type: MarkerType.Arrow } },
  { id: "e3-4", source: "3", target: "4", markerEnd: { type: MarkerType.Arrow } },
];

// ===== Component =====

export default function PipelinesPage() {
  const [nodes, setNodes] = useState<any[]>(initialNodesState);
  const [edges] = useState<any[]>(initialEdgesState);

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(true);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const [expandedMappings, setExpandedMappings] = useState<Record<number, boolean>>({});
  const [sqlTab, setSqlTab] = useState<"ddl" | "dml" | "warnings">("ddl");

  // Fetch connectors on mount
  useEffect(() => {
    const fetchConnectors = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/v1/connectors/");
        if (res.ok) {
          const data = await res.json();
          setConnectors(data || []);
        }
      } catch (err) {
        console.error("Failed to load connectors", err);
      } finally {
        setConnectorsLoading(false);
      }
    };
    fetchConnectors();
  }, []);

  // Lookup helpers
  const connectorById = useMemo(() => {
    const map = new Map<number, Connector>();
    connectors.forEach((c) => map.set(c.id, c));
    return map;
  }, [connectors]);

  const sourceNode = nodes.find((n) => n.data.nodeType === "source");
  const targetNode = nodes.find((n) => n.data.nodeType === "target");
  const sourceConnectionId = sourceNode?.data?.config?.connection_id as number | undefined;
  const targetConnectionId = targetNode?.data?.config?.connection_id as number | undefined;
  const isReady = !!sourceConnectionId && !!targetConnectionId;

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  // ===== Handlers =====

  const handleNodeClick = (_event: any, node: any) => {
    setSelectedNodeId(node.id);
    setExecuteError(null);
  };

  const handlePaneClick = () => {
    setSelectedNodeId(null);
  };

  const updateNodeConnection = (nodeId: string, connectionId: number | undefined) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const nodeType: PipelineNodeType = n.data.nodeType;
        const conn = connectionId ? connectorById.get(connectionId) : undefined;
        const newData = {
          ...n.data,
          config: { ...(n.data.config || {}), connection_id: connectionId },
          label: buildLabel(nodeType, conn?.name),
        };
        return { ...n, data: newData };
      })
    );
  };

  const handleExecute = async () => {
    if (!isReady || executing) return;
    setExecuting(true);
    setExecuteError(null);
    setResult(null);

    // Build backend payload: drop mask nodes and their dangling edges
    const executableNodes = nodes
      .filter((n) => n.data.nodeType !== "mask")
      .map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        config: n.data.config,
        position: n.position,
      }));

    const executableNodeIds = new Set(executableNodes.map((n) => n.id));
    const executableEdges = edges
      .filter((e) => executableNodeIds.has(e.source) && executableNodeIds.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target }));

    try {
      const res = await fetch("http://localhost:8000/api/v1/pipelines/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: executableNodes, edges: executableEdges }),
      });

      if (!res.ok) {
        let detail = `Request failed with status ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody?.detail) detail = errBody.detail;
        } catch {
          // ignore JSON parse error
        }
        setExecuteError(detail);
        return;
      }

      const data: ExecuteResult = await res.json();
      setResult(data);
      setExpandedMappings({});
      setSqlTab("ddl");
    } catch (err) {
      setExecuteError("Failed to reach backend. Please ensure the API is running.");
    } finally {
      setExecuting(false);
    }
  };

  const toggleMapping = (idx: number) => {
    setExpandedMappings((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Apply selected outline to the currently selected node
  const displayNodes = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      style: { ...(n.style || {}), ...(selectedNodeId === n.id ? SELECTED_STYLE : {}) },
    }));
  }, [nodes, selectedNodeId]);

  // ===== Render =====

  return (
    <div className="p-0 flex h-full flex-col">
      {/* Toolbar */}
      <div className="p-6 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Visual Transformation Studio</h3>
          <p className="text-xs text-zinc-500">
            Drag and drop nodes to design visual pipelines workflows mappings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isReady && (
            <span className="text-xs text-zinc-500">
              Configure both source and target to execute
            </span>
          )}
          <button
            onClick={handleExecute}
            disabled={!isReady || executing}
            title={
              !isReady
                ? "Select both source and target connections first"
                : "Execute the pipeline"
            }
            className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 flex items-center gap-2"
          >
            {executing && (
              <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {executing ? "Executing pipeline..." : "▶️ Execute Pipeline"}
          </button>
        </div>
      </div>

      {/* Canvas + side panel */}
      <div className="flex-1 w-full bg-zinc-950/20 relative flex">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            fitView
            attributionPosition="bottom-right"
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
          >
            <Background color="#52525b" gap={16} size={1} />
            <Controls className="!bg-zinc-900 !border-zinc-800 !text-zinc-400" />
          </ReactFlow>

          {/* Node Library Overlay */}
          <div className="absolute top-4 left-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-md w-48 flex flex-col gap-2 shadow-2xl">
            <span className="text-xs font-semibold text-zinc-400 mb-2">Node Library</span>
            {[
              { icon: "🔌", label: "Source" },
              { icon: "❄️", label: "Target" },
              { icon: "🧠", label: "AI Transformer" },
              { icon: "🛡️", label: "Security Mask" },
            ].map((item, i) => (
              <div
                key={i}
                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 border border-zinc-700/50 flex items-center gap-2 cursor-grab transition-all"
              >
                <span>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* Config side panel */}
        {selectedNode && (
          <div className="w-80 border-l border-zinc-800 bg-zinc-900/60 backdrop-blur-md p-5 flex flex-col gap-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-200">Node Configuration</h4>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-zinc-500">
              Type:{" "}
              <span className="text-zinc-300 font-mono">{selectedNode.data.nodeType}</span>
              <br />
              ID: <span className="text-zinc-300 font-mono">{selectedNode.id}</span>
            </div>

            {selectedNode.data.nodeType === "source" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                  Source Connection
                </label>
                {connectorsLoading ? (
                  <div className="text-xs text-zinc-500">Loading connectors...</div>
                ) : connectors.length === 0 ? (
                  <div className="text-xs text-amber-400">
                    No connectors available. Create one in the Connectors page.
                  </div>
                ) : (
                  <select
                    value={selectedNode.data.config?.connection_id ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateNodeConnection(
                        selectedNode.id,
                        val ? Number(val) : undefined
                      );
                    }}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">— Select connection —</option>
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.type})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-zinc-500 mt-1">
                  Choose the database connection to read from.
                </p>
              </div>
            )}

            {selectedNode.data.nodeType === "target" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                  Target Connection
                </label>
                {connectorsLoading ? (
                  <div className="text-xs text-zinc-500">Loading connectors...</div>
                ) : connectors.length === 0 ? (
                  <div className="text-xs text-amber-400">
                    No connectors available. Create one in the Connectors page.
                  </div>
                ) : (
                  <select
                    value={selectedNode.data.config?.connection_id ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateNodeConnection(
                        selectedNode.id,
                        val ? Number(val) : undefined
                      );
                    }}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">— Select connection —</option>
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.type})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-zinc-500 mt-1">
                  Choose the destination database connection.
                </p>
              </div>
            )}

            {selectedNode.data.nodeType === "ai_matcher" && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-400 leading-relaxed">
                <div className="text-zinc-200 font-semibold mb-2">🧠 AI Matcher</div>
                AI Matcher automatically maps source tables to target tables using semantic
                matching. No configuration required.
              </div>
            )}

            {selectedNode.data.nodeType === "mask" && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-400 leading-relaxed">
                <div className="text-zinc-200 font-semibold mb-2">🛡️ Security Mask</div>
                Security Mask node is decorative in this MVP.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {executeError && (
        <div className="mx-6 mt-4 p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm flex items-start gap-2">
          <span className="font-semibold">Error:</span>
          <span className="flex-1">{executeError}</span>
          <button
            onClick={() => setExecuteError(null)}
            className="text-rose-300/70 hover:text-rose-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Results panel */}
      {result && (
        <div className="border-t border-zinc-800 bg-zinc-900/30 backdrop-blur-sm p-6 flex flex-col gap-5">
          {/* Summary header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h4 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                Pipeline executed successfully
              </h4>
              <p className="text-xs text-zinc-500 mt-1">
                {result.source} → {result.target} · {result.table_mappings.length} table
                {result.table_mappings.length === 1 ? "" : "s"} mapped
              </p>
            </div>
            <div className="text-xs text-zinc-500">
              {result.migration_sql.total_statements} SQL statements generated
            </div>
          </div>

          {result.table_mappings.length === 0 && (
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-400">
              No strong table mappings found.
            </div>
          )}

          {/* Table mappings */}
          {result.table_mappings.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {result.table_mappings.map((m, idx) => {
                const isOpen = !!expandedMappings[idx];
                return (
                  <div
                    key={`${m.source_table}-${m.target_table}-${idx}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm overflow-hidden"
                  >
                    <button
                      onClick={() => toggleMapping(idx)}
                      className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-zinc-900/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-zinc-200 truncate">
                          {m.source_table} → {m.target_table}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">
                          {m.details.matches.length} column match
                          {m.details.matches.length === 1 ? "" : "es"}
                          {m.details.ai_processed && " · AI processed"}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${confidenceColor(
                          m.confidence
                        )}`}
                      >
                        {Math.round(m.confidence)}%
                      </span>
                      <span className="text-zinc-500 text-xs ml-1">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-zinc-800 p-4 bg-zinc-950/40">
                        {m.details.matches.length === 0 ? (
                          <div className="text-xs text-zinc-500">No column matches.</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-zinc-500 text-left">
                                <th className="font-medium pb-2">Source Column</th>
                                <th className="font-medium pb-2">Target Column</th>
                                <th className="font-medium pb-2 w-32">Confidence</th>
                                <th className="font-medium pb-2">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.details.matches.map((cm, ci) => (
                                <tr
                                  key={ci}
                                  className="border-t border-zinc-800/60 align-middle"
                                >
                                  <td className="py-2 font-mono text-zinc-200">{cm.source}</td>
                                  <td className="py-2 font-mono text-zinc-200">{cm.target}</td>
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                                          style={{ width: `${Math.max(0, Math.min(100, cm.confidence))}%` }}
                                        />
                                      </div>
                                      <span
                                        className={`text-[10px] font-semibold w-9 text-right ${confidenceTextColor(
                                          cm.confidence
                                        )}`}
                                      >
                                        {Math.round(cm.confidence)}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-2 text-zinc-400 text-[11px]">
                                    {cm.reason}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Unmatched tables */}
          {(result.unmatched_source.length > 0 || result.unmatched_target.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm p-4">
                <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                  Unmatched Source ({result.unmatched_source.length})
                </div>
                {result.unmatched_source.length === 0 ? (
                  <div className="text-xs text-zinc-500">All source tables matched.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {result.unmatched_source.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm p-4">
                <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                  Unmatched Target ({result.unmatched_target.length})
                </div>
                {result.unmatched_target.length === 0 ? (
                  <div className="text-xs text-zinc-500">All target tables matched.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {result.unmatched_target.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Generated SQL */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <div className="flex gap-1">
                {(
                  [
                    { key: "ddl", label: `DDL (${result.migration_sql.ddl.length})` },
                    { key: "dml", label: `DML (${result.migration_sql.dml.length})` },
                    {
                      key: "warnings",
                      label: `Warnings (${result.migration_sql.warnings.length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setSqlTab(tab.key)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      sqlTab === tab.key
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">SQL</span>
            </div>
            <div className="p-4">
              {sqlTab === "ddl" && (
                <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre">
                  {result.migration_sql.ddl.length === 0
                    ? "-- No DDL statements"
                    : result.migration_sql.ddl.join("\n\n")}
                </pre>
              )}
              {sqlTab === "dml" && (
                <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre">
                  {result.migration_sql.dml.length === 0
                    ? "-- No DML statements"
                    : result.migration_sql.dml.join("\n\n")}
                </pre>
              )}
              {sqlTab === "warnings" && (
                <div className="flex flex-col gap-2">
                  {result.migration_sql.warnings.length === 0 ? (
                    <div className="text-xs text-zinc-500">No warnings.</div>
                  ) : (
                    result.migration_sql.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs"
                      >
                        ⚠ {w}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
