"use client";
/**
 * Schema Intel — catalog browsing, profiling, classification, and drift
 * (schema_intel_tasks Task #5).
 *
 * Replaces the pre-TRD "Schema Matcher" (AI-based table/column matching
 * against POST /api/v1/agent/schema-match). That functionality is
 * duplicated by Schema Mapper's own AI-suggestion flow and Pipelines'
 * legacy AI matcher — nothing else in the frontend links to this route's
 * matcher UI, so it's a clean replacement, not a fork.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useCatalog } from "./hooks/useCatalog";

import ConnectionPicker from "./components/ConnectionPicker";
import CatalogSearchBar from "./components/CatalogSearchBar";
import CatalogTableCard from "./components/CatalogTableCard";
import DriftHistoryPanel from "./components/DriftHistoryPanel";
import Toast from "./components/Toast";

export default function SchemaIntelPage() {
  const router = useRouter();
  const c = useCatalog();

  useEffect(() => {
    if (c.catalogError && c.catalogError.toLowerCase().includes("not authenticated")) {
      router.push("/login");
    }
  }, [c.catalogError, router]);

  const canManage = c.role === "admin" || c.role === "analyst";

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-border bg-surface-elevated backdrop-blur-sm flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg-muted">Schema Intel</h3>
          <p className="text-xs text-fg0">
            Browse the discovered catalog, profile columns, review PII classifications, and track drift
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ConnectionPicker
              connections={c.connections}
              loading={c.connectionsLoading}
              connectionId={c.connectionId}
              onChange={c.setConnectionId}
            />
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => void c.scanConnection()}
                  disabled={c.scanning || c.connectionId === null}
                  className="px-3 py-2 text-xs font-semibold text-fg-muted border border-border-strong rounded-lg hover:bg-surface-overlay disabled:opacity-50"
                >
                  {c.scanning ? "Scanning…" : "Scan catalog"}
                </button>
                <button
                  type="button"
                  onClick={() => void c.profileConnection()}
                  disabled={c.profiling || c.connectionId === null || c.tables.length === 0}
                  title={c.tables.length === 0 ? "Scan the catalog first" : undefined}
                  className="px-3 py-2 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {c.profiling ? "Enqueuing…" : "Profile columns"}
                </button>
              </>
            )}
          </div>
        </div>

        <CatalogSearchBar
          q={c.q}
          onQChange={c.setQ}
          dataType={c.dataType}
          onDataTypeChange={c.setDataType}
          classificationLabel={c.classificationLabel}
          onClassificationLabelChange={c.setClassificationLabel}
        />

        {c.catalogLoading ? (
          <div className="text-xs text-fg0">Loading catalog…</div>
        ) : c.catalogError ? (
          <div className="text-xs text-red-400">{c.catalogError}</div>
        ) : c.tables.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-5xl mb-3">🗂️</div>
            <h2 className="text-lg font-semibold text-fg-muted mb-2">No catalog yet</h2>
            <p className="text-sm text-fg0">
              {canManage
                ? <>Click <span className="text-fg-muted">Scan catalog</span> to discover this connection&apos;s tables and columns.</>
                : "This connection hasn't been scanned yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {c.tables.map((t) => (
              <CatalogTableCard key={t.id} table={t} role={c.role} onOverride={c.overrideClassification} />
            ))}
          </div>
        )}

        <DriftHistoryPanel history={c.driftHistory} onRescan={() => void c.rescanForDrift()} role={c.role} connectionId={c.connectionId} />
      </div>

      <Toast toast={c.toast} onDismiss={c.clearToast} />
    </div>
  );
}
