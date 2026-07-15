"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { classNames, formatRelativeTime } from "../lib/format";
import type { ConnectorRef, Paginated, Pipeline, PublishedMappingRef, Role } from "../lib/types";

interface PipelineListProps {
  pipelines: Pipeline[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  listError: string | null;
  selectedId: number | null;
  role: Role | null;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  onCreate: (input: {
    name: string; source_connection_id: number; target_connection_id: number; mapping_id: number;
  }) => Promise<Pipeline>;
}

export default function PipelineList({
  pipelines, total, hasMore, loading, loadingMore, listError,
  selectedId, role, onSelect, onLoadMore, onCreate,
}: PipelineListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const canCreate = role === "admin" || role === "analyst";

  return (
    <aside className="w-72 border-r border-border bg-surface-elevated flex flex-col" aria-label="Pipelines list">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg-muted">
            Pipelines{total > 0 ? ` · ${total}` : ""}
          </h3>
          <p className="text-[10px] text-fg0 uppercase tracking-wider">Scheduled &amp; on-demand</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90"
            aria-label="Create new pipeline"
          >
            + New
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-fg0">Loading…</div>
        ) : listError ? (
          <div className="p-4 text-xs text-red-400">{listError}</div>
        ) : pipelines.length === 0 ? (
          <div className="p-4 text-xs text-fg0">
            No pipelines yet.{canCreate && <> Click <span className="text-fg-muted">+ New</span> to create one.</>}
          </div>
        ) : (
          <>
            <ul className="p-2 flex flex-col gap-1">
              {pipelines.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    aria-current={selectedId === p.id ? "true" : undefined}
                    className={classNames(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-all border",
                      selectedId === p.id
                        ? "bg-blue-600/10 border-blue-500/30 text-blue-300"
                        : "border-transparent hover:bg-surface-overlay text-fg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{p.name}</span>
                      <span
                        className={classNames(
                          "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                          p.enabled
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-surface-overlay text-fg-subtle",
                        )}
                      >
                        {p.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-fg0 flex items-center gap-2">
                      <span>#{p.id}</span>
                      <span>·</span>
                      <span>{p.schedule ? "scheduled" : "manual"}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(p.updated_at)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full py-1.5 text-[11px] font-medium text-fg-subtle hover:text-fg-muted border border-border rounded-lg hover:bg-surface-overlay disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : `Load more (${pipelines.length} of ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreatePipelineModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            setShowCreate(false);
            onSelect(p.id);
          }}
          onCreate={onCreate}
        />
      )}
    </aside>
  );
}

function CreatePipelineModal({
  onClose, onCreated, onCreate,
}: {
  onClose: () => void;
  onCreated: (p: Pipeline) => void;
  onCreate: (input: {
    name: string; source_connection_id: number; target_connection_id: number; mapping_id: number;
  }) => Promise<Pipeline>;
}) {
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [mappings, setMappings] = useState<PublishedMappingRef[]>([]);
  const [name, setName] = useState("");
  const [mappingId, setMappingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRefs, setLoadingRefs] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoadingRefs(true);
      try {
        const [connData, mapData] = await Promise.all([
          api.get<ConnectorRef[]>("/api/v1/connectors/"),
          api.get<Paginated<PublishedMappingRef>>("/api/v1/mappings/?limit=200&offset=0"),
        ]);
        setConnectors(connData);
        setMappings(mapData.items.filter((m) => m.status === "published"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load connections/mappings.");
      } finally {
        setLoadingRefs(false);
      }
    })();
  }, []);

  const selectedMapping = mappings.find((m) => m.id === mappingId) ?? null;
  const connectorName = (id: number | null) => connectors.find((c) => c.id === id)?.name ?? "unknown";

  const submit = async () => {
    if (!name.trim() || !selectedMapping || selectedMapping.source_id === null || selectedMapping.target_id === null) {
      setError("Name and a published mapping are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const p = await onCreate({
        name: name.trim(),
        source_connection_id: selectedMapping.source_id,
        target_connection_id: selectedMapping.target_id,
        mapping_id: selectedMapping.id,
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create pipeline.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create pipeline"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface border border-border p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-fg mb-1">New Pipeline</h2>
        <p className="text-xs text-fg0 mb-4">
          A pipeline moves data from a source to a target using a published Schema Mapper mapping.
        </p>

        {loadingRefs ? (
          <div className="text-xs text-fg0 py-4">Loading connections and mappings…</div>
        ) : mappings.length === 0 ? (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
            No published mappings found. Publish a mapping in Schema Mapper first — pipelines can
            only run against a published, immutable mapping version.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-xs text-fg-subtle">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CRM → DW nightly sync"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="text-xs text-fg-subtle">
              Published mapping
              <select
                value={mappingId ?? ""}
                onChange={(e) => setMappingId(Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500"
              >
                <option value="" disabled>Select a published mapping…</option>
                {mappings.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            {selectedMapping && (
              <div className="text-[11px] text-fg0 bg-surface-overlay rounded-lg px-3 py-2">
                Source: <span className="text-fg-muted">{connectorName(selectedMapping.source_id)}</span>
                {" → "}
                Target: <span className="text-fg-muted">{connectorName(selectedMapping.target_id)}</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fg-subtle hover:text-fg-muted rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || loadingRefs || mappings.length === 0}
            className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}
