"use client";
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import type { Tenant, TenantUser, TenantResource, AuditEvent } from "../lib/types";

interface TenantDetailProps {
  tenantId: number;
  onBack: () => void;
  onRefresh: () => void;
}

type Tab = "overview" | "resources" | "users" | "audit";

export default function TenantDetail({ tenantId, onBack, onRefresh }: TenantDetailProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<TenantUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [resources, setResources] = useState<TenantResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get<Tenant>(`/api/v1/tenants/${tenantId}`)
      .then(data => setTenant(data))
      .catch(err => setError(err instanceof ApiError ? err.message : "Failed to load tenant."))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (tab !== "users") return;
    setUsersLoading(true);
    api.get<TenantUser[]>(`/api/v1/tenants/${tenantId}/users`)
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [tab, tenantId]);

  useEffect(() => {
    if (tab !== "resources") return;
    setResourcesLoading(true);
    api.get<TenantResource[]>(`/api/v1/tenants/${tenantId}/resources`)
      .then(data => setResources(Array.isArray(data) ? data : []))
      .catch(() => setResources([]))
      .finally(() => setResourcesLoading(false));
  }, [tab, tenantId]);

  useEffect(() => {
    if (tab !== "audit") return;
    setAuditLoading(true);
    api.get<AuditEvent[]>(`/api/v1/audit?tenant_id=${tenantId}&page_size=20`)
      .then(data => setAuditEvents(Array.isArray(data) ? data : []))
      .catch(() => setAuditEvents([]))
      .finally(() => setAuditLoading(false));
  }, [tab, tenantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2 text-sm text-fg0">
          <span className="w-4 h-4 border border-border-strong border-t-transparent rounded-full animate-spin" />
          Loading tenant...
        </div>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="p-5 rounded-2xl bg-surface-elevated border border-red-500/30">
        <p className="text-sm text-red-400">{error || "Tenant not found."}</p>
        <button onClick={onBack} className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-strong text-fg-muted hover:bg-surface-overlay">
          ← Back to tenants
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "resources", label: "Resources" },
    { id: "users", label: "Users" },
    { id: "audit", label: "Audit" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-fg0 hover:text-fg-muted text-sm">←</button>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-fg-muted">{tenant.name}</h3>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                tenant.status === "active"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"
              }`}>
                {tenant.status}
              </span>
            </div>
            <span className="text-xs text-fg0 font-mono">{tenant.slug} · Created {new Date(tenant.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-all ${
              tab === t.id
                ? "bg-surface-overlay text-fg-muted border border-border-strong border-b-transparent"
                : "text-fg0 hover:text-fg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResourceCard label="Connections" value={tenant.resource_counts?.connections ?? 0} max={tenant.resource_limits?.max_connections} icon="🔌" />
          <ResourceCard label="Mappings" value={tenant.resource_counts?.mappings ?? 0} max={tenant.resource_limits?.max_mappings} icon="🗺️" />
          <ResourceCard label="Pipelines" value={tenant.resource_counts?.pipelines ?? 0} max={tenant.resource_limits?.max_pipelines} icon="🔗" />
          <ResourceCard label="Users" value={tenant.resource_counts?.users ?? 0} icon="👤" />
        </div>
      )}

      {tab === "resources" && (
        <div>
          {resourcesLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-fg0">Loading resources...</div>
          ) : resources.length === 0 ? (
            <div className="text-center py-8 text-sm text-fg0">No resources in this tenant.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2 font-semibold text-fg-subtle">Type</th>
                  <th className="p-2 font-semibold text-fg-subtle">Name</th>
                  <th className="p-2 font-semibold text-fg-subtle">Status</th>
                  <th className="p-2 font-semibold text-fg-subtle">Created</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 hover:bg-surface-overlay">
                    <td className="p-2">
                      <span className="text-fg-subtle">{r.type === "connection" ? "🔌" : r.type === "mapping" ? "🗺️" : "🔗"} {r.type}</span>
                    </td>
                    <td className="p-2 text-fg-muted">{r.name}</td>
                    <td className="p-2">
                      <span className="text-fg-subtle">{r.status}</span>
                    </td>
                    <td className="p-2 text-fg0">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "users" && (
        <div>
          {usersLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-fg0">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-sm text-fg0">No users in this tenant.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2 font-semibold text-fg-subtle">Name</th>
                  <th className="p-2 font-semibold text-fg-subtle">Email</th>
                  <th className="p-2 font-semibold text-fg-subtle">Role</th>
                  <th className="p-2 font-semibold text-fg-subtle">Last Active</th>
                  <th className="p-2 font-semibold text-fg-subtle">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 hover:bg-surface-overlay">
                    <td className="p-2 text-fg-muted">{u.name}</td>
                    <td className="p-2 text-fg-subtle">{u.email}</td>
                    <td className="p-2 text-fg-muted">{u.role}</td>
                    <td className="p-2 text-fg0">{u.last_active ? new Date(u.last_active).toLocaleDateString() : "—"}</td>
                    <td className="p-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        u.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-surface-overlay text-fg0"
                      }`}>
                        {u.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div>
          {auditLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-fg0">Loading audit events...</div>
          ) : auditEvents.length === 0 ? (
            <div className="text-center py-8 text-sm text-fg0">No audit events for this tenant.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2 font-semibold text-fg-subtle">Timestamp</th>
                  <th className="p-2 font-semibold text-fg-subtle">Actor</th>
                  <th className="p-2 font-semibold text-fg-subtle">Action</th>
                  <th className="p-2 font-semibold text-fg-subtle">Target</th>
                  <th className="p-2 font-semibold text-fg-subtle">Module</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((e, i) => (
                  <tr key={e.id ?? i} className="border-b border-border/60 hover:bg-surface-overlay">
                    <td className="p-2 text-fg-subtle whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="p-2 text-fg-muted">{e.actor}</td>
                    <td className="p-2 text-fg-muted">{e.action}</td>
                    <td className="p-2 text-fg-subtle">{e.target}</td>
                    <td className="p-2 text-fg0">{e.module}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ResourceCard({ label, value, max, icon }: { label: string; value: number; max?: number | null; icon: string }) {
  const pct = max != null && max > 0 ? Math.round((value / max) * 100) : null;
  return (
    <div className="p-5 rounded-2xl bg-surface-elevated border border-border">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-fg0">{label}</span>
      </div>
      <div className="text-2xl font-bold text-fg-muted">
        {value}
        {max != null && <span className="text-sm text-fg0 font-normal"> / {max}</span>}
      </div>
      {pct != null && (
        <div className="mt-2">
          <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-fg0 mt-1">{pct}% used</span>
        </div>
      )}
    </div>
  );
}