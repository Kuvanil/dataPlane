"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Connection } from "../query-studio/lib/types";
import WriteConfirmModal from "../query-studio/components/WriteConfirmModal";
import AskDataView from "./components/AskDataView";
import SqlWorkspaceView, { type SqlWorkspaceViewHandle, type WriteConfirmDetails } from "./components/SqlWorkspaceView";
import { readAndClearWorkspaceHandoff, type WorkspaceHandoff } from "./lib/handoff";

const MODE_DISPLAY_NAMES: Record<string, string> = {
  schema_intel: "Schema Intel",
  schema_mapper: "Schema Mapper",
};

function QueryWorkspaceInner() {
  const searchParams = useSearchParams();

  // ── WorkspaceHandoff from Schema Intel / Schema Mapper (task #9) ─
  // Read (and clear) exactly once via a lazy useState initializer rather
  // than an effect — an effect that calls setState only on mount (empty
  // deps) causes an extra render pass for no benefit; a lazy initializer
  // resolves everything it seeds in the very first render. Must be declared
  // before mode/connectionId/etc. below since they read from it.
  const [handoff] = useState<WorkspaceHandoff | null>(() =>
    typeof window === "undefined" ? null : readAndClearWorkspaceHandoff()
  );

  // ── Mode state — handoff's mode wins over ?mode= (decision #10) ─
  const [mode, setMode] = useState<"ask" | "sql">(() => {
    if (handoff) return handoff.mode;
    const m = searchParams.get("mode");
    if (m === "sql" || m === "ask") return m;
    return "ask";
  });

  // ── Shared connection state (single fetch, task #2) ────────────
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(() => handoff?.connectionId ?? null);
  const connectionsFetchedRef = useRef(false);

  useEffect(() => {
    if (connectionsFetchedRef.current) return;
    connectionsFetchedRef.current = true;
    api.get<Connection[]>("/api/v1/connectors/")
      .then((data) => {
        setConnections(data);
        if (data.length > 0) setConnectionId((cur) => cur ?? data[0].id);
      })
      .catch(() => setConnections([]));
  }, []);

  // ── Ref to SqlWorkspaceView for imperative access (write-confirm modal only) ──
  const sqlViewRef = useRef<SqlWorkspaceViewHandle>(null);

  // ── SQL text handed off from AskData or from a WorkspaceHandoff ─
  // Applied declaratively via SqlWorkspaceView's externalSqlText prop —
  // both subviews are always mounted (decision #1), so there's no need
  // to defer through a ref + setTimeout.
  const [externalSqlText, setExternalSqlText] = useState<string | undefined>(() =>
    handoff?.mode === "sql" ? handoff.sql : undefined
  );
  const clearExternalSqlText = useCallback(() => setExternalSqlText(undefined), []);

  // ── In-shell handoff from AskData → SQL mode (task #3) ─────────
  const handleEditInSql = useCallback((handoffConnectionId: number, sql: string) => {
    setConnectionId(handoffConnectionId);
    setMode("sql");
    setExternalSqlText(sql);
  }, []);

  const [handoffBanner, setHandoffBanner] = useState<WorkspaceHandoff["banner"] | null>(
    () => handoff?.banner ?? null
  );
  const [prefillQuestion] = useState<string | undefined>(() =>
    handoff?.mode === "ask" ? handoff.prefillQuestion : undefined
  );

  // ── Mode-switch guardrails (task #4) ──────────────────────────
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [writeConfirmDetails, setWriteConfirmDetails] = useState<WriteConfirmDetails | null>(null);
  const [bgAskComplete, setBgAskComplete] = useState(false);
  const [bgSqlComplete, setBgSqlComplete] = useState(false);

  const handlePendingConfirmChange = useCallback((pending: boolean) => {
    setPendingConfirm(pending);
  }, []);

  const handleSqlBackgroundComplete = useCallback(() => {
    if (mode !== "sql") {
      setBgSqlComplete(true);
      setTimeout(() => setBgSqlComplete(false), 3000);
    }
  }, [mode]);

  const handleAskBackgroundComplete = useCallback(() => {
    if (mode !== "ask") {
      setBgAskComplete(true);
      setTimeout(() => setBgAskComplete(false), 3000);
    }
  }, [mode]);

  // ── Mode toggle handler ────────────────────────────────────────
  const handleModeChange = useCallback((newMode: "ask" | "sql") => {
    if (newMode === mode) return;
    setMode(newMode);
    setBgAskComplete(false);
    setBgSqlComplete(false);
  }, [mode]);

  return (
    <div className="flex h-full flex-col">
      {/* ── Header with mode toggle ─────────────────────────────── */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex justify-between items-center shrink-0">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Query Workspace</h3>
          <p className="text-xs text-zinc-500">Ask in plain English or write SQL — switch freely, no state lost.</p>
        </div>
        <div className="flex items-center gap-2 bg-zinc-800/60 rounded-lg p-0.5">
          <button
            onClick={() => handleModeChange("ask")}
            className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              mode === "ask"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Ask
            {bgAskComplete && mode !== "ask" && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" />
            )}
          </button>
          <button
            onClick={() => handleModeChange("sql")}
            className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              mode === "sql"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            SQL
            {bgSqlComplete && mode !== "sql" && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* ── WorkspaceHandoff banner (task #9) ───────────────────── */}
      {handoffBanner && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between">
          <span className="text-xs text-blue-300">
            📋 Investigating: {handoffBanner.summary} — from{" "}
            {MODE_DISPLAY_NAMES[handoffBanner.sourceModule] ?? handoffBanner.sourceModule}
          </span>
          <button
            onClick={() => setHandoffBanner(null)}
            className="text-xs text-blue-400 hover:text-blue-300 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Both subviews kept mounted, toggled with `hidden` class (decision #1) ── */}
      <div className={`flex-1 overflow-hidden ${mode === "ask" ? "" : "hidden"}`}>
        <AskDataView
          connections={connections}
          connectionId={connectionId}
          setConnectionId={setConnectionId}
          prefillQuestion={prefillQuestion}
          onEditInSql={handleEditInSql}
          onBackgroundComplete={handleAskBackgroundComplete}
        />
      </div>
      <div className={`flex-1 overflow-hidden ${mode === "sql" ? "" : "hidden"}`}>
        <SqlWorkspaceView
          ref={sqlViewRef}
          connections={connections}
          connectionId={connectionId}
          setConnectionId={setConnectionId}
          externalSqlText={externalSqlText}
          onSqlTextApplied={clearExternalSqlText}
          onPendingConfirmChange={handlePendingConfirmChange}
          onWriteConfirmDetailsChange={setWriteConfirmDetails}
          onBackgroundComplete={handleSqlBackgroundComplete}
        />
      </div>

      {/* ── Write-confirm modal rendered at shell level (task #4) ──
          Data comes from writeConfirmDetails state (reported reactively by
          SqlWorkspaceView), never read off sqlViewRef during render. */}
      {pendingConfirm && writeConfirmDetails && (
        <WriteConfirmModal
          statementType={writeConfirmDetails.statementType}
          warnings={writeConfirmDetails.warnings}
          onConfirm={() => {
            sqlViewRef.current?.confirmWrite();
            setPendingConfirm(false);
          }}
          onCancel={() => {
            sqlViewRef.current?.cancelWrite();
            setPendingConfirm(false);
          }}
        />
      )}
    </div>
  );
}

export default QueryWorkspaceInner;