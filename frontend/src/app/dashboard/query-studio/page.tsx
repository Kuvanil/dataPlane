"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import SqlEditor from "./components/SqlEditor";
import ConnectionSelector from "./components/ConnectionSelector";
import ResultsTable from "./components/ResultsTable";
import WriteConfirmModal from "./components/WriteConfirmModal";
import SavedQueriesPanel from "./components/SavedQueriesPanel";
import HistoryPanel from "./components/HistoryPanel";
import {
  CatalogTableListResponse, Connection, HistoryResponse,
  QueryExecuteResult, SavedQuery,
} from "./lib/types";

const DEFAULT_PAGE_SIZE = 100;

export default function QueryStudioPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [sqlText, setSqlText] = useState("");
  const [catalogTables, setCatalogTables] = useState<CatalogTableListResponse["tables"]>([]);
  const [result, setResult] = useState<QueryExecuteResult | null>(null);
  const [page, setPage] = useState(1);
  const [running, setRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"saved" | "history">("history");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Consume a handoff from AskData ("Edit in Query Studio") if present —
  // read synchronously on mount, before the async connections fetch below
  // resolves, so its `cur ?? data[0].id` fallback never overrides it.
  useEffect(() => {
    const raw = sessionStorage.getItem("qs-handoff");
    if (!raw) return;
    sessionStorage.removeItem("qs-handoff");
    try {
      const { connectionId: handoffConnectionId, sql } = JSON.parse(raw);
      if (typeof handoffConnectionId === "number") setConnectionId(handoffConnectionId);
      if (typeof sql === "string") setSqlText(sql);
    } catch {
      // malformed handoff payload — ignore, editor just stays empty
    }
  }, []);

  useEffect(() => {
    api.get<Connection[]>("/api/v1/connectors/")
      .then((data) => {
        setConnections(data);
        if (data.length > 0) setConnectionId((cur) => cur ?? data[0].id);
      })
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    if (connectionId == null) return;
    api.get<CatalogTableListResponse>(`/api/v1/catalog/${connectionId}/tables`)
      .then((data) => setCatalogTables(data.tables))
      .catch(() => setCatalogTables([]));
    api.get<SavedQuery[]>(`/api/v1/query-studio/saved?connection_id=${connectionId}`)
      .then(setSavedQueries)
      .catch(() => setSavedQueries([]));
  }, [connectionId]);

  const refreshHistory = useCallback(() => {
    api.get<HistoryResponse>("/api/v1/query-studio/history")
      .then(setHistory)
      .catch(() => setHistory(null));
  }, []);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  const runQuery = useCallback(async (opts: { confirm?: boolean; page?: number } = {}) => {
    if (connectionId == null || !sqlText.trim()) return;
    setRunning(true);
    setErrorBanner(null);
    const targetPage = opts.page ?? page;
    try {
      const data = await api.post<QueryExecuteResult>("/api/v1/query-studio/execute", {
        connection_id: connectionId,
        sql: sqlText,
        page: targetPage,
        page_size: DEFAULT_PAGE_SIZE,
        confirm: opts.confirm ?? false,
      });
      setResult(data);
      setPage(targetPage);
      if (data.requires_confirmation) {
        setPendingConfirm(true);
      } else {
        setPendingConfirm(false);
        refreshHistory();
      }
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : "Query execution failed — is the API reachable?");
    } finally {
      setRunning(false);
    }
  }, [connectionId, sqlText, page, refreshHistory]);

  const changePage = (newPage: number) => runQuery({ page: newPage });

  const confirmWrite = () => runQuery({ confirm: true, page: 1 });

  const exportCsv = async () => {
    if (connectionId == null || !sqlText.trim()) return;
    try {
      const { blob, filename } = await api.downloadPost("/api/v1/query-studio/export", {
        connection_id: connectionId, sql: sqlText, page: 1, page_size: DEFAULT_PAGE_SIZE,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : "Export failed");
    }
  };

  const saveCurrentQuery = async () => {
    if (connectionId == null || !sqlText.trim()) return;
    const name = window.prompt("Name this query:");
    if (!name) return;
    try {
      await api.post("/api/v1/query-studio/saved", { connection_id: connectionId, name, sql_text: sqlText });
      const updated = await api.get<SavedQuery[]>(`/api/v1/query-studio/saved?connection_id=${connectionId}`);
      setSavedQueries(updated);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : "Could not save query");
    }
  };

  const deleteSavedQuery = async (id: number) => {
    try {
      await api.delete(`/api/v1/query-studio/saved/${id}`);
      setSavedQueries((qs) => qs.filter((q) => q.id !== id));
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : "Could not delete query");
    }
  };

  const loadSavedQuery = (q: SavedQuery) => {
    setConnectionId(q.connection_id);
    setSqlText(q.sql_text);
    setResult(null);
  };

  const connectionType = connections.find((c) => c.id === connectionId)?.type;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-zinc-200">Query Studio</h3>
              <p className="text-xs text-zinc-500">Write SQL, run it against a connection, export the results.</p>
            </div>
            <ConnectionSelector connections={connections} value={connectionId} onChange={setConnectionId} />
          </div>

          <SqlEditor
            value={sqlText}
            onChange={setSqlText}
            connectionType={connectionType}
            tables={catalogTables}
            onRun={() => runQuery({ page: 1 })}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => runQuery({ page: 1 })}
              disabled={running || !sqlText.trim() || connectionId == null}
              className="px-5 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
            >
              {running ? "Running…" : "▶ Run (⌘/Ctrl+Enter)"}
            </button>
            <button
              onClick={exportCsv}
              disabled={!sqlText.trim() || connectionId == null}
              className="px-3 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={saveCurrentQuery}
              disabled={!sqlText.trim() || connectionId == null}
              className="px-3 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-50"
            >
              Save
            </button>
          </div>

          {errorBanner && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {errorBanner}
            </div>
          )}
          {result && result.warnings.length > 0 && !result.requires_confirmation && (
            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              {result.warnings.join(" ")}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {result ? (
            <ResultsTable result={result} page={page} onPageChange={changePage} />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center text-zinc-500 gap-3 pt-16">
              <span className="text-5xl">🗄️</span>
              <span className="text-sm">Write a query and run it to see results here.</span>
            </div>
          )}
        </div>
      </div>

      <div className="w-72 border-l border-zinc-800 flex flex-col">
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setSidebarTab("history")}
            className={`flex-1 py-2 text-xs ${sidebarTab === "history" ? "text-zinc-100 border-b-2 border-blue-500" : "text-zinc-500"}`}
          >
            History
          </button>
          <button
            onClick={() => setSidebarTab("saved")}
            className={`flex-1 py-2 text-xs ${sidebarTab === "saved" ? "text-zinc-100 border-b-2 border-blue-500" : "text-zinc-500"}`}
          >
            Saved
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sidebarTab === "history" ? (
            <HistoryPanel entries={history?.history ?? []} onLoad={setSqlText} />
          ) : (
            <SavedQueriesPanel queries={savedQueries} onLoad={loadSavedQuery} onDelete={deleteSavedQuery} />
          )}
        </div>
      </div>

      {pendingConfirm && result && (
        <WriteConfirmModal
          statementType={result.statement_type}
          warnings={result.warnings}
          onConfirm={confirmWrite}
          onCancel={() => setPendingConfirm(false)}
        />
      )}
    </div>
  );
}
