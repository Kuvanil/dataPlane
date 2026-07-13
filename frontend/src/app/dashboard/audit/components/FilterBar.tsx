"use client";
import { AuditFacets, AuditFilters } from "../lib/types";

export default function FilterBar({
  filters,
  onChange,
  facets,
  onRefresh,
}: {
  filters: AuditFilters;
  onChange: (next: AuditFilters) => void;
  facets: AuditFacets | null;
  onRefresh: () => void;
}) {
  const set = (patch: Partial<AuditFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <input
        type="text"
        placeholder="Search summary / event type / actor…"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 min-w-[220px]"
      />
      <select
        value={filters.module}
        onChange={(e) => set({ module: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
      >
        <option value="">All Modules</option>
        {Object.keys(facets?.modules ?? {}).map((m) => (
          <option key={m} value={m}>{m} ({facets?.modules[m]})</option>
        ))}
      </select>
      <select
        value={filters.event_type}
        onChange={(e) => set({ event_type: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
      >
        <option value="">All Event Types</option>
        {Object.keys(facets?.event_types ?? {}).map((t) => (
          <option key={t} value={t}>{t} ({facets?.event_types[t]})</option>
        ))}
      </select>
      <select
        value={filters.outcome}
        onChange={(e) => set({ outcome: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
      >
        <option value="">All Outcomes</option>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
        <option value="warning">Warning</option>
      </select>
      <input
        type="text"
        placeholder="Actor"
        value={filters.actor}
        onChange={(e) => set({ actor: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 w-36"
      />
      <input
        type="datetime-local"
        aria-label="From date"
        value={filters.date_from}
        onChange={(e) => set({ date_from: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
      />
      <input
        type="datetime-local"
        aria-label="To date"
        value={filters.date_to}
        onChange={(e) => set({ date_to: e.target.value })}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2"
      />
      <button
        onClick={onRefresh}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}
