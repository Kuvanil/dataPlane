"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Connection {
  id: number;
  name: string;
  type: string;
  config?: any;
}

interface ColumnInfo {
  name: string;
  type: string;
  primary_key?: boolean;
  nullable?: boolean;
}

type SchemaMap = Record<string, ColumnInfo[]>;

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

interface SchemaMatchResult {
  source: string;
  target: string;
  table_mappings: TableMapping[];
  unmatched_source: string[];
  unmatched_target: string[];
  total_source_tables: number;
  total_target_tables: number;
}

type TaskStatus = "idle" | "pending" | "success" | "failure" | "timeout";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30;
const API_BASE = "http://localhost:8000/api/v1";

/* ────────────────── helpers ────────────────── */
function confidenceBadgeClasses(confidence: number): string {
  if (confidence >= 80) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (confidence >= 50) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

function connectionName(list: Connection[], id: number | null): string {
  if (id == null) return "";
  return list.find((c) => c.id === id)?.name || `Connection #${id}`;
}

export default function SchemaPage() {
  /* ── Connections ── */
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  /* ── Selection ── */
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  /* ── Schemas ── */
  const [sourceSchema, setSourceSchema] = useState<SchemaMap | null>(null);
  const [targetSchema, setTargetSchema] = useState<SchemaMap | null>(null);
  const [sourceSchemaLoading, setSourceSchemaLoading] = useState(false);
  const [targetSchemaLoading, setTargetSchemaLoading] = useState(false);
  const [sourceSchemaError, setSourceSchemaError] = useState<string | null>(null);
  const [targetSchemaError, setTargetSchemaError] = useState<string | null>(null);

  /* ── Task state ── */
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [pollCount, setPollCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [result, setResult] = useState<SchemaMatchResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const pollRef = useRef<{ cancelled: boolean } | null>(null);

  /* ────────────────── Connections bootstrap ────────────────── */
  const fetchConnections = useCallback(async () => {
    try {
      setConnectionsLoading(true);
      const res = await fetch(`${API_BASE}/connectors/`);
      if (!res.ok) {
        console.error("Connections fetch failed:", res.status);
        return;
      }
      const data = await res.json();
      const list: Connection[] = Array.isArray(data) ? data : [];
      setConnections(list);

      // Pre-select defaults: CRM (id 1) as source, DW (id 2) as target
      if (list.some((c) => c.id === 1)) setSourceId(1);
      if (list.some((c) => c.id === 2)) setTargetId(2);
    } catch (err) {
      console.error("Connections fetch failed:", err);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  /* ────────────────── Schema fetchers ────────────────── */
  const fetchSchema = useCallback(
    async (connId: number, side: "source" | "target") => {
      if (side === "source") {
        setSourceSchemaLoading(true);
        setSourceSchema(null);
        setSourceSchemaError(null);
      } else {
        setTargetSchemaLoading(true);
        setTargetSchema(null);
        setTargetSchemaError(null);
      }
      try {
        const res = await fetch(`${API_BASE}/connectors/${connId}/schema`);
        if (!res.ok) {
          const dbName = connectionName(connections, connId) || `connection ${connId}`;
          const msg = `Could not load schema for ${dbName}. Connection may be broken.`;
          if (side === "source") setSourceSchemaError(msg);
          else setTargetSchemaError(msg);
          return;
        }
        const data = await res.json();
        const schema: SchemaMap = data?.schema && typeof data.schema === "object" ? data.schema : {};
        if (side === "source") setSourceSchema(schema);
        else setTargetSchema(schema);
      } catch (err) {
        console.error(`Schema fetch failed for ${side}:`, err);
        const dbName = connectionName(connections, connId) || `connection ${connId}`;
        const msg = `Could not load schema for ${dbName}. Connection may be broken.`;
        if (side === "source") setSourceSchemaError(msg);
        else setTargetSchemaError(msg);
      } finally {
        if (side === "source") setSourceSchemaLoading(false);
        else setTargetSchemaLoading(false);
      }
    },
    [connections]
  );

  useEffect(() => {
    if (sourceId != null) fetchSchema(sourceId, "source");
    // If user clears source, drop the schema
    if (sourceId == null) {
      setSourceSchema(null);
      setSourceSchemaError(null);
    }
  }, [sourceId, fetchSchema]);

  useEffect(() => {
    if (targetId != null) fetchSchema(targetId, "target");
    if (targetId == null) {
      setTargetSchema(null);
      setTargetSchemaError(null);
    }
  }, [targetId, fetchSchema]);

  // Reset result state when either side changes
  useEffect(() => {
    if (pollRef.current) pollRef.current.cancelled = true;
    setTaskStatus("idle");
    setResult(null);
    setErrorMessage("");
    setStatusMessage("");
    setPollCount(0);
    setExpanded(new Set());
  }, [sourceId, targetId]);

  /* ────────────────── Polling ────────────────── */
  const pollTask = useCallback(async (taskId: string) => {
    const handle = { cancelled: false };
    pollRef.current = handle;
    for (let i = 0; i < MAX_POLLS; i++) {
      if (handle.cancelled) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (handle.cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}`);
        if (!res.ok) {
          console.error("Task poll failed:", res.status);
          continue;
        }
        const data = await res.json();
        setPollCount(i + 1);
        if (data.status === "SUCCESS") {
          const r: SchemaMatchResult | undefined = data.result;
          setResult(r || null);
          setTaskStatus("success");
          setStatusMessage("Analysis complete.");
          setErrorMessage("");
          return;
        }
        if (data.status === "FAILURE") {
          setResult(null);
          setTaskStatus("failure");
          setStatusMessage("");
          setErrorMessage(
            (data.error && typeof data.error === "string" ? data.error : null) ||
              "Analysis failed."
          );
          return;
        }
        setStatusMessage(`Analyzing schemas... (poll ${i + 1}/${MAX_POLLS})`);
      } catch (err) {
        console.error("Task poll error:", err);
      }
    }
    if (!handle.cancelled) {
      setTaskStatus("timeout");
      setStatusMessage("");
      setErrorMessage("Analysis timed out. Please try again.");
    }
  }, []);

  // Cleanup any in-flight poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) pollRef.current.cancelled = true;
    };
  }, []);

  /* ────────────────── Analyze action ────────────────── */
  const sameDb = sourceId != null && targetId != null && sourceId === targetId;
  const canAnalyze =
    sourceId != null &&
    targetId != null &&
    !sameDb &&
    taskStatus !== "pending" &&
    !sourceSchemaLoading &&
    !targetSchemaLoading &&
    sourceSchema != null &&
    targetSchema != null &&
    Object.keys(sourceSchema).length > 0 &&
    Object.keys(targetSchema).length > 0;

  const runAnalysis = useCallback(async () => {
    if (!canAnalyze || sourceId == null || targetId == null) return;
    if (pollRef.current) pollRef.current.cancelled = true;

    setTaskStatus("pending");
    setStatusMessage("Submitting analysis task...");
    setErrorMessage("");
    setResult(null);
    setPollCount(0);
    setExpanded(new Set());

    try {
      const url = `${API_BASE}/agent/schema-match?source_id=${sourceId}&target_id=${targetId}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        setTaskStatus("failure");
        setStatusMessage("");
        setErrorMessage(`Failed to submit analysis task (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      if (!data.task_id) {
        setTaskStatus("failure");
        setStatusMessage("");
        setErrorMessage("Backend did not return a task_id.");
        return;
      }
      setStatusMessage(`Analyzing schemas... (poll 0/${MAX_POLLS})`);
      await pollTask(data.task_id);
    } catch (err) {
      console.error("Analyze failed:", err);
      setTaskStatus("failure");
      setStatusMessage("");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error");
    }
  }, [canAnalyze, sourceId, targetId, pollTask]);

  /* ────────────────── Render helpers ────────────────── */
  const sourceDbName = connectionName(connections, sourceId);
  const targetDbName = connectionName(connections, targetId);
  const isAnalyzing = taskStatus === "pending";
  const showResult = taskStatus === "success" && result;

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  /* ────────────────── Render ────────────────── */
  return (
    <div className="p-8 flex flex-col gap-6 h-full">
      {/* ── Toolbar ── */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 backdrop-blur-sm">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Schema Intelligence Matcher</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Pick a source and target database. The agent will analyze every table pair and surface semantic mappings.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <select
            value={sourceId ?? ""}
            onChange={(e) => setSourceId(e.target.value === "" ? null : Number(e.target.value))}
            disabled={connectionsLoading}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          >
            <option value="">Source Database</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <span className="text-zinc-600 text-xs">→</span>

          <select
            value={targetId ?? ""}
            onChange={(e) => setTargetId(e.target.value === "" ? null : Number(e.target.value))}
            disabled={connectionsLoading}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          >
            <option value="">Target Database</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={runAnalysis}
            disabled={!canAnalyze}
            className="px-4 py-2 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-xl hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>🤖</span>
            {result ? "Re-Analyze Schema" : "Analyze Schema"}
          </button>
        </div>
      </div>

      {/* ── Source === Target inline error ── */}
      {sameDb && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          Source and target must be different databases.
        </div>
      )}

      {/* ── Status banners ── */}
      {isAnalyzing && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span>{statusMessage || "Submitting analysis task..."}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-blue-400/70 font-semibold">Processing</span>
        </div>
      )}

      {taskStatus === "failure" && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span>❌</span>
            <span className="font-semibold">Analysis Failed:</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={runAnalysis}
            className="px-3 py-1.5 text-xs font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {taskStatus === "timeout" && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span>⏱️</span>
            <span className="font-semibold">Timeout:</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={runAnalysis}
            className="px-3 py-1.5 text-xs font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {taskStatus === "success" && result && (
        <div className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
          {statusMessage} Found {result.table_mappings.length} table pair
          {result.table_mappings.length === 1 ? "" : "s"}.
        </div>
      )}

      {/* ── Schema Preview ── */}
      {(sourceId != null || targetId != null) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Source preview */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Source Schema</div>
                <div className="text-sm font-semibold text-zinc-200 mt-0.5">
                  {sourceDbName || (sourceId != null ? `Connection #${sourceId}` : "—")}
                </div>
              </div>
              {sourceSchema && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  {Object.keys(sourceSchema).length} table
                  {Object.keys(sourceSchema).length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="p-3 max-h-[260px] overflow-y-auto">
              {sourceId == null ? (
                <div className="p-6 text-center text-zinc-500 text-xs">Select a source database above.</div>
              ) : sourceSchemaLoading ? (
                <div className="p-6 flex items-center justify-center gap-2 text-zinc-400 text-xs">
                  <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Loading schema...
                </div>
              ) : sourceSchemaError ? (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {sourceSchemaError}
                </div>
              ) : sourceSchema && Object.keys(sourceSchema).length === 0 ? (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
                  No tables found in {sourceDbName}.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {Object.entries(sourceSchema || {}).map(([table, cols]) => (
                    <li
                      key={table}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-800/60 hover:bg-zinc-800/70 transition-colors"
                    >
                      <span className="font-mono text-xs text-blue-300 truncate">{table}</span>
                      <span className="text-[10px] text-zinc-500 font-semibold ml-2 shrink-0">
                        {cols.length} col{cols.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Target preview */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Target Schema</div>
                <div className="text-sm font-semibold text-zinc-200 mt-0.5">
                  {targetDbName || (targetId != null ? `Connection #${targetId}` : "—")}
                </div>
              </div>
              {targetSchema && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  {Object.keys(targetSchema).length} table
                  {Object.keys(targetSchema).length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="p-3 max-h-[260px] overflow-y-auto">
              {targetId == null ? (
                <div className="p-6 text-center text-zinc-500 text-xs">Select a target database above.</div>
              ) : targetSchemaLoading ? (
                <div className="p-6 flex items-center justify-center gap-2 text-zinc-400 text-xs">
                  <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Loading schema...
                </div>
              ) : targetSchemaError ? (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {targetSchemaError}
                </div>
              ) : targetSchema && Object.keys(targetSchema).length === 0 ? (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
                  No tables found in {targetDbName}.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {Object.entries(targetSchema || {}).map(([table, cols]) => (
                    <li
                      key={table}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-800/60 hover:bg-zinc-800/70 transition-colors"
                    >
                      <span className="font-mono text-xs text-indigo-300 truncate">{table}</span>
                      <span className="text-[10px] text-zinc-500 font-semibold ml-2 shrink-0">
                        {cols.length} col{cols.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {showResult && result && (
        <div className="flex flex-col gap-6">
          {/* Summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryStat label="Source tables" value={result.total_source_tables} accent="text-blue-300" />
            <SummaryStat label="Target tables" value={result.total_target_tables} accent="text-indigo-300" />
            <SummaryStat
              label="Matched pairs"
              value={result.table_mappings.length}
              accent="text-emerald-300"
            />
            <SummaryStat
              label="Unmatched source"
              value={result.unmatched_source.length}
              accent="text-amber-300"
            />
            <SummaryStat
              label="Unmatched target"
              value={result.unmatched_target.length}
              accent="text-amber-300"
            />
          </div>

          {/* No strong matches info banner */}
          {result.table_mappings.length === 0 && (
            <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm">
              No strong table-level matches found. Try selecting different databases.
            </div>
          )}

          {/* Matched Table Pairs */}
          {result.table_mappings.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-sm font-semibold text-zinc-200">Matched Table Pairs</h4>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  {result.table_mappings.length} pair{result.table_mappings.length === 1 ? "" : "s"}
                </span>
              </div>
              {result.table_mappings.map((tm, idx) => {
                const isOpen = expanded.has(idx);
                const matches = tm.details?.matches || [];
                return (
                  <div
                    key={`${tm.source_table}->${tm.target_table}-${idx}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs text-blue-300 truncate">{tm.source_table}</span>
                        <span className="text-zinc-600 text-xs">→</span>
                        <span className="font-mono text-xs text-indigo-300 truncate">{tm.target_table}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${confidenceBadgeClasses(
                            tm.confidence
                          )}`}
                        >
                          {tm.confidence}%
                        </span>
                        <span className="text-[10px] text-zinc-500 font-semibold hidden sm:inline">
                          {isOpen ? "Hide columns" : "View Column Mappings"}
                        </span>
                        <span
                          className={`text-zinc-500 text-xs transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        >
                          ▼
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-zinc-800 bg-zinc-900/50">
                        {matches.length === 0 ? (
                          <div className="p-4 text-center text-xs text-zinc-500 italic">
                            No column-level matches identified for this pair.
                          </div>
                        ) : (
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-zinc-800">
                                <th className="p-3 font-semibold text-zinc-400">Source Column</th>
                                <th className="p-3 font-semibold text-zinc-400">Target Column</th>
                                <th className="p-3 font-semibold text-zinc-400 w-48">Confidence</th>
                                <th className="p-3 font-semibold text-zinc-400">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matches.map((m, mi) => (
                                <tr
                                  key={`${m.source}-${m.target}-${mi}`}
                                  className="border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/20"
                                >
                                  <td className="p-3 font-mono text-blue-400">{m.source}</td>
                                  <td className="p-3 font-mono text-indigo-400">{m.target}</td>
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                                          style={{ width: `${Math.max(0, Math.min(100, m.confidence))}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] font-semibold text-zinc-300 w-9 text-right">
                                        {m.confidence}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-3 text-zinc-400 italic">{m.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className="px-3 py-2 text-[10px] text-zinc-600 border-t border-zinc-800/60 flex items-center gap-2">
                          <span>
                            AI processed:{" "}
                            <span className={tm.details?.ai_processed ? "text-emerald-400" : "text-zinc-500"}>
                              {tm.details?.ai_processed ? "yes" : "rule-based fallback"}
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Unmatched Tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UnmatchedCard
              title="Unmatched Source Tables"
              accent="blue"
              tables={result.unmatched_source}
            />
            <UnmatchedCard
              title="Unmatched Target Tables"
              accent="indigo"
              tables={result.unmatched_target}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────── Sub-components ────────────────── */
function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</span>
      <span className={`text-2xl font-bold ${accent}`}>{value}</span>
    </div>
  );
}

function UnmatchedCard({
  title,
  tables,
  accent,
}: {
  title: string;
  tables: string[];
  accent: "blue" | "indigo";
}) {
  const titleColor = accent === "blue" ? "text-blue-300" : "text-indigo-300";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-zinc-200">{title}</h4>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          {tables.length}
        </span>
      </div>
      <div className="p-3 max-h-[200px] overflow-y-auto">
        {tables.length === 0 ? (
          <div className="p-3 text-center text-xs text-zinc-500 italic">All tables matched</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tables.map((t) => (
              <li
                key={t}
                className="px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-800/60 font-mono text-xs"
              >
                <span className={titleColor}>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
