"use client";
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import Link from "next/link";
import type { Connector, DependencyInfo } from "../lib/types";

interface DeleteConnectorDialogProps {
  connector: Connector;
  onClose: () => void;
  onDeleted: () => void;
}

export default function DeleteConnectorDialog({ connector, onClose, onDeleted }: DeleteConnectorDialogProps) {
  const [dependencies, setDependencies] = useState<DependencyInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DependencyInfo>(`/api/v1/connectors/${connector.id}/dependencies`)
      .then(data => setDependencies(data))
      .catch(() => setDependencies({ mappings: [], pipelines: [] }))
      .finally(() => setChecking(false));
  }, [connector.id]);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/api/v1/connectors/${connector.id}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete connector.");
    } finally {
      setDeleting(false);
    }
  };

  const hasDeps = dependencies && (dependencies.mappings.length > 0 || dependencies.pipelines.length > 0);
  const totalDeps = (dependencies?.mappings.length ?? 0) + (dependencies?.pipelines.length ?? 0);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-2xl bg-surface border border-border flex flex-col gap-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-fg-muted">Delete Connector</h3>
        <p className="text-sm text-fg-subtle">
          Are you sure you want to delete <span className="font-semibold text-fg-muted">{connector.name}</span>?
          This action will soft-delete the connector.
        </p>

        {checking ? (
          <div className="flex items-center gap-2 text-xs text-fg0">
            <span className="w-3 h-3 border border-border-strong border-t-transparent rounded-full animate-spin" />
            Checking dependencies...
          </div>
        ) : hasDeps ? (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <p className="text-xs text-amber-400 font-semibold mb-2">
              ⚠️ This connector is used by {totalDeps} resource(s)
            </p>
            {dependencies!.mappings.length > 0 && (
              <div className="mb-2">
                <span className="text-[10px] text-fg0 uppercase tracking-wider">Mappings</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {dependencies!.mappings.slice(0, 5).map(m => (
                    <li key={m.id}>
                      <Link href={`/dashboard/schema-mapper`} className="text-xs text-blue-400 hover:text-blue-300">
                        🗺️ {m.name}
                      </Link>
                    </li>
                  ))}
                  {dependencies!.mappings.length > 5 && (
                    <li className="text-[10px] text-fg0">+{dependencies!.mappings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {dependencies!.pipelines.length > 0 && (
              <div>
                <span className="text-[10px] text-fg0 uppercase tracking-wider">Pipelines</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {dependencies!.pipelines.slice(0, 5).map(p => (
                    <li key={p.id}>
                      <Link href={`/dashboard/pipelines`} className="text-xs text-blue-400 hover:text-blue-300">
                        🔗 {p.name}
                      </Link>
                    </li>
                  ))}
                  {dependencies!.pipelines.length > 5 && (
                    <li className="text-[10px] text-fg0">+{dependencies!.pipelines.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
            <p className="text-xs text-emerald-400">✓ No dependencies — safe to delete.</p>
          </div>
        )}

        {error && (
          <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
        )}

        <div className="flex gap-2 mt-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 py-2 bg-surface-overlay hover:bg-surface-overlay rounded-xl text-sm font-semibold text-fg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || checking}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${
              hasDeps
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            {deleting ? "Deleting..." : hasDeps ? "Delete Anyway" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}