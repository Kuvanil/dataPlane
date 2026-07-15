"use client";
import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import SqlEditor from "../../query-studio/components/SqlEditor";
import ConnectionSelector from "../../query-studio/components/ConnectionSelector";
import ResultsTable from "../../query-studio/components/ResultsTable";
import HistoryPanel from "../../query-studio/components/HistoryPanel";
import SavedQueriesPanel from "../../query-studio/components/SavedQueriesPanel";
import type {
  CatalogTableListResponse, Connection, HistoryResponse,
  QueryExecuteResult, SavedQuery,
} from "../../query-studio/lib/types";

const DEFAULT_PAGE_SIZE = 100;

export interface SqlWorkspaceViewHandle {
  confirmWrite: () => void;
  cancelWrite: () => void;
}

export interface WriteConfirmDetails {
  statementType: string;
  warnings: string[];
}

interface SqlWorkspaceViewProps {
  connections: Connection[];
  connectionId: number | null;
  setConnectionId: (id: number) => void;
  /** External setter for sqlText — used by in-shell handoff & WorkspaceHandoff */
  externalSqlText?: string;
  onSqlTextApplied?: () => void;
  /** Called when pendingConfirm state changes */
  onPendingConfirmChange?: (pending: boolean) => void;
  /**
   * Called with the details the shell-level WriteConfirmModal needs
   * whenever they change (or null once there's nothing pending) — the
   * shell must not read these off a ref during render (React refs are only
   * safe to read in event handlers/effects, never in the render body).
   */
  onWriteConfirmDetailsChange?: (details: WriteConfirmDetails | null) => void;
  /** Called when running state transitions from true to false (background completion) */
  onBackgroundComplete?: () => void;
}

const SqlWorkspaceView = forwardRef<SqlWorkspaceViewHandle, SqlWorkspaceViewProps>(function SqlWorkspaceView({
  connections,
  connectionId,
  setConnectionId,
  externalSqlText,
  onSqlTextApplied,
  onPendingConfirmChange,
  onWriteConfirmDetailsChange,
  onBackgroundComplete,
}, ref) {
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

  // Apply externalSqlText when it changes (from handoff)
  useEffect(() => {
    if (externalSqlText !== undefined && externalSqlText !== null) {
      setSqlText(externalSqlText);
      onSqlTextApplied?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSqlText]);

  // Notify parent of pendingConfirm changes
  useEffect(() => {
    onPendingConfirmChange?.(pendingConfirm);
  }, [pendingConfirm, onPendingConfirmChange]);

  // Report the shell-level modal's data reactively — never let the parent
  // read it off a ref during render (react-hooks/refs: refs are only safe
  // to read in event handlers/effects, not in the render body).
  useEffect(() => {
    onWriteConfirmDetailsChange?.(
      pendingConfirm ? { statementType: result?.statement_type ?? "write", warnings: result?.warnings ?? [] } : null
    );
  }, [pendingConfirm, result, onWriteConfirmDetailsChange]);

  // Track running → false transitions for background-completion badge
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      onBackgroundComplete?.();
    }
    prevRunningRef.current = running;
  }, [running, onBackgroundComplete]);

  // Fetch catalog tables and saved queries when connection changes
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

  // Expose imperative handle to parent — event-handler-only calls
  // (confirm/cancel), safe under react-hooks/refs since they're never
  // invoked during render.
  useImperativeHandle(ref, () => ({
    confirmWrite: () => runQuery({ confirm: true, page: 1 }),
    cancelWrite: () => setPendingConfirm(false),
  }), [runQuery]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-border bg-surface-elevated backdrop-blur-sm flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-fg-muted">Query Studio</h3>
              <p className="text-xs text-fg0">Write SQL, run it against a connection, export the results.</p>
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
              className="px-3 py-2 text-xs bg-surface-overlay hover:bg-surface-overlay text-fg-muted rounded-lg disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={saveCurrentQuery}
              disabled={!sqlText.trim() || connectionId == null}
              className="px-3 py-2 text-xs bg-surface-overlay hover:bg-surface-overlay text-fg-muted rounded-lg disabled:opacity-50"
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
            <div className="flex-1 h-full flex flex-col items-center justify-center text-fg0 gap-3 pt-16">
              <span className="text-5xl">🗄️</span>
              <span className="text-sm">Write a query and run it to see results here.</span>
            </div>
          )}
        </div>
      </div>

      <div className="w-72 border-l border-border flex flex-col">
        <div className="flex border-b border-border">
          <button
            onClick={() => setSidebarTab("history")}
            className={`flex-1 py-2 text-xs ${sidebarTab === "history" ? "text-fg border-b-2 border-blue-500" : "text-fg0"}`}
          >
            History
          </button>
          <button
            onClick={() => setSidebarTab("saved")}
            className={`flex-1 py-2 text-xs ${sidebarTab === "saved" ? "text-fg border-b-2 border-blue-500" : "text-fg0"}`}
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
    </div>
  );
});

export default SqlWorkspaceView;

