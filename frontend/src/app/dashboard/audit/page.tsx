"use client";
import { useState } from "react";
import { useAuditEvents } from "./hooks/useAuditEvents";
import FilterBar from "./components/FilterBar";
import EventTable from "./components/EventTable";
import EventDetail from "./components/EventDetail";
import ExportButton from "./components/ExportButton";
import { AuditEvent, AuditFilters, EMPTY_FILTERS, SortBy, SortOrder } from "./lib/types";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const { data, isLoading, isError, errorMessage, refetch } = useAuditEvents(
    filters, page, PAGE_SIZE, sortBy, sortOrder,
  );

  const handleFilters = (next: AuditFilters) => {
    setFilters(next);
    setPage(1);
  };

  const handleSort = (col: SortBy) => {
    if (col === sortBy) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
  };

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Audit Trail</h1>
        <ExportButton filters={filters} />
      </div>

      <FilterBar
        filters={filters}
        onChange={handleFilters}
        facets={data?.facets ?? null}
        onRefresh={refetch}
      />

      {isError && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          Failed to load audit events{errorMessage ? `: ${errorMessage}` : "."}
        </div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: selected ? "1fr 420px" : "1fr" }}>
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 overflow-hidden overflow-x-auto">
          <EventTable
            events={events}
            isLoading={isLoading}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            onSelect={setSelected}
            selectedId={selected?.id ?? null}
          />
        </div>
        {selected && (
          <EventDetail event={selected} onClose={() => setSelected(null)} onSelectEvent={setSelected} />
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">{total} event{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-zinc-400">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
