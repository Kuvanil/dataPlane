"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { classNames, formatRelativeTime } from "../lib/format";
import type { ConnectorRef, Mapping, Paginated, Role } from "../lib/types";

const PAGE_SIZE = 50;

interface MappingListProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (input: { name: string; source_id: number; target_id: number }) => Promise<Mapping>;
  role: Role | null;
  // Primitive id/name pair (not the full Mapping object) so this effect
  // only fires when the open mapping's name actually changes, not on
  // every render. Patches the sidebar's own cached copy in place instead
  // of a full re-fetch — the header's inline-rename (mapper_tasks #6)
  // previously updated only the workspace header's local state, leaving
  // this list showing the stale name until a manual reload.
  renamedMappingId?: number | null;
  renamedMappingName?: string | null;
}

export default function MappingList({
  selectedId,
  onSelect,
  onCreate,
  role,
  renamedMappingId,
  renamedMappingName,
}: MappingListProps) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Review §11.8: the backend paginates (NFR: ≥10,000 mappings/tenant), so
  // the sidebar fetches PAGE_SIZE at a time and exposes a "Load more"
  // affordance instead of requesting everything at once.
  const fetchMappings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Paginated<Mapping>>(
        `/api/v1/mappings/?limit=${PAGE_SIZE}&offset=0`,
      );
      setMappings(data.items);
      setTotal(data.total);
      setHasMore(data.has_more);
    } catch (err) {
      // Fallback to empty list on auth/connection error.
      if (err instanceof ApiError && err.status === 401) {
        setError("Not authenticated.");
      } else {
        setError("Backend unreachable.");
      }
      setMappings([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<Paginated<Mapping>>(
        `/api/v1/mappings/?limit=${PAGE_SIZE}&offset=${mappings.length}`,
      );
      setMappings((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(data.has_more);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to load more mappings.";
      setError(message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchMappings();
  }, []);

  useEffect(() => {
    if (renamedMappingId == null || renamedMappingName == null) return;
    setMappings((prev) =>
      prev.map((m) =>
        m.id === renamedMappingId ? { ...m, name: renamedMappingName } : m,
      ),
    );
  }, [renamedMappingId, renamedMappingName]);

  return (
    <aside
      className="w-72 border-r border-zinc-800 bg-zinc-900/30 flex flex-col"
      aria-label="Mappings list"
    >
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Mappings{total > 0 ? ` · ${total}` : ""}
          </h3>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Drafts & published
          </p>
        </div>
        {(role === "admin" || role === "analyst") && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90"
            aria-label="Create new mapping"
          >
            + New
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-zinc-500">Loading…</div>
        ) : error ? (
          <div className="p-4 text-xs text-red-400">{error}</div>
        ) : mappings.length === 0 ? (
          <div className="p-4 text-xs text-zinc-500">
            No mappings yet. Click <span className="text-zinc-300">+ New</span> to create one.
          </div>
        ) : (
          <>
            <ul className="p-2 flex flex-col gap-1">
              {mappings.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.id)}
                    aria-current={selectedId === m.id ? "true" : undefined}
                    className={classNames(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-all border",
                      selectedId === m.id
                        ? "bg-blue-600/10 border-blue-500/30 text-blue-300"
                        : "border-transparent hover:bg-zinc-800/40 text-zinc-300",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.name}</span>
                      <span
                        className={classNames(
                          "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                          m.status === "published"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-400",
                        )}
                      >
                        {m.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500 flex items-center gap-2">
                      <span>#{m.id}</span>
                      <span>·</span>
                      <span>{m.edges.length} edges</span>
                      <span>·</span>
                      <span>{formatRelativeTime(m.updated_at)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="w-full py-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded-lg hover:bg-zinc-800/40 disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : `Load more (${mappings.length} of ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateMappingModal
          onClose={() => setShowCreate(false)}
          onCreated={(m) => {
            setShowCreate(false);
            void fetchMappings().then(() => onSelect(m.id));
          }}
          onCreate={onCreate}
        />
      )}
    </aside>
  );
}

function CreateMappingModal({
  onClose,
  onCreated,
  onCreate,
}: {
  onClose: () => void;
  onCreated: (m: Mapping) => void;
  onCreate: (input: { name: string; source_id: number; target_id: number }) => Promise<Mapping>;
}) {
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ConnectorRef[]>("/api/v1/connectors/")
      .then((data) => {
        setConnectors(data);
        if (data.length >= 2) {
          setSourceId(data[0].id);
          setTargetId(data[1].id);
        } else if (data.length === 1) {
          setSourceId(data[0].id);
          setTargetId(data[0].id);
        }
      })
      .catch((err: unknown) => {
        // Review §11.7: NEVER fabricate production-shaped connector data on
        // a failed API call. The previous behaviour silently injected five
        // hardcoded connections, letting a user create a mapping draft
        // against IDs that don't exist in the system.
        //
        // Demo mode opt-in: when NEXT_PUBLIC_DEMO_MODE === "1", keep the
        // dev convenience of a hardcoded list so local exploration works
        // without a live backend. Default is OFF in production.
        const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
        if (demoMode) {
          setConnectors([
            { id: 1, name: "CRM_Source_Analytics", type: "sqlite" },
            { id: 2, name: "Data_Warehouse_Target", type: "sqlite" },
            { id: 3, name: "ECommerce_MySQL", type: "sqlite" },
            { id: 4, name: "Finance_Oracle", type: "oracle" },
            { id: 5, name: "HR_Postgres", type: "postgres" },
          ]);
        } else {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load connections from the backend.";
          setError(
            `Could not load connections: ${message}. ` +
              `Set NEXT_PUBLIC_DEMO_MODE=1 in .env.local for offline demo data.`,
          );
          setConnectors([]);
        }
      });
  }, []);

  const submit = async () => {
    if (!name.trim() || sourceId === null || targetId === null) {
      setError("All fields are required.");
      return;
    }
    if (sourceId === targetId) {
      setError("Source and target must be different connections.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const m = await onCreate({
        name: name.trim(),
        source_id: sourceId,
        target_id: targetId,
      });
      onCreated(m);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to create mapping.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create mapping"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">New Mapping</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Create a draft mapping. You can save and publish later.
        </p>
        <div className="flex flex-col gap-3">
          <label className="text-xs text-zinc-400">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CRM → DW Customer Sync"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Source connection
            <select
              value={sourceId ?? ""}
              onChange={(e) => setSourceId(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
            >
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Target connection
            <select
              value={targetId ?? ""}
              onChange={(e) => setTargetId(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
            >
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
