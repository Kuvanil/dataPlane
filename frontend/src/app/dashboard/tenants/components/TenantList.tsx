"use client";
import { api, ApiError } from "@/lib/api";
import type { Tenant } from "../lib/types";

interface TenantListProps {
  tenants: Tenant[];
  loading: boolean;
  error: string | null;
  onSelect: (id: number) => void;
  onRefresh: () => void;
  onNew: () => void;
}

export default function TenantList({ tenants, loading, error, onSelect, onRefresh, onNew }: TenantListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-5 rounded-2xl bg-surface-elevated border border-border animate-pulse">
            <div className="h-4 w-32 bg-surface-overlay rounded mb-3" />
            <div className="h-3 w-48 bg-surface-overlay rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 rounded-2xl bg-surface-elevated border border-red-500/30">
        <p className="text-sm text-red-400">{error}</p>
        <button onClick={onRefresh} className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10">
          Retry
        </button>
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-fg0">
        <span className="text-4xl mb-3">🏢</span>
        <p className="text-sm font-medium text-fg-muted">No tenants configured</p>
        <p className="text-xs mt-1">Create your first tenant to get started.</p>
        <button onClick={onNew} className="mt-4 px-4 py-2 text-sm font-semibold text-fg bg-white rounded-xl hover:bg-surface">
          ➕ Create Tenant
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {tenants.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className="w-full text-left p-5 rounded-2xl bg-surface-elevated border border-border hover:border-border-strong transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-xl">🏢</span>
              <div>
                <h4 className="font-semibold text-fg-muted">{t.name}</h4>
                <span className="text-[10px] text-fg0 font-mono">{t.slug}</span>
              </div>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              t.status === "active"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
            }`}>
              {t.status}
            </span>
          </div>
          {t.resource_counts && (
            <div className="flex gap-4 text-xs text-fg0 mt-3 pt-3 border-t border-border/50">
              <span>🔌 {t.resource_counts.connections} connections</span>
              <span>🗺️ {t.resource_counts.mappings} mappings</span>
              <span>🔗 {t.resource_counts.pipelines} pipelines</span>
              <span>👤 {t.resource_counts.users} users</span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}