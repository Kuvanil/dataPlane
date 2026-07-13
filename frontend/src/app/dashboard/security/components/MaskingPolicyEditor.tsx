"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ConnectorRef, MaskingPolicy, MaskingType, Role, RoleRecord } from "../lib/types";
import { MASKING_TYPES } from "../lib/types";
import { maskingTypeLabel, roleColor } from "../lib/format";

interface CatalogColumnLite {
  column_name: string;
}
interface CatalogTableLite {
  table_name: string;
  columns: CatalogColumnLite[];
}

interface MaskingPolicyEditorProps {
  role: Role | null;
  connections: ConnectorRef[];
  policies: MaskingPolicy[];
  loading: boolean;
  roles: RoleRecord[];
  onCreate: (payload: {
    connection_id: number; table_name: string; column_name: string;
    masking_type: string; exempt_roles: string[];
  }) => Promise<void>;
  onDelete: (policyId: number) => Promise<void>;
}

/** Client-side mirror of app.services.rbac_service.MaskingPolicyCRUD.apply_masking,
 * used only to render a live "before -> after" preview — the actual
 * enforcement always happens server-side in VizService.run_query. */
function previewMask(value: string, maskingType: MaskingType): string {
  switch (maskingType) {
    case "redact": return "***";
    case "hash": return value ? `sha256:${value.length.toString(16)}...` : value;
    case "truncate": return value ? `${value[0]}***` : value;
    case "substitute": return "[MASKED]";
    case "nullify": return "null";
    default: return value;
  }
}

export default function MaskingPolicyEditor({
  role, connections, policies, loading, roles, onCreate, onDelete,
}: MaskingPolicyEditorProps) {
  const canManage = role === "admin";
  const [connectionId, setConnectionId] = useState<number | "">("");
  const [tables, setTables] = useState<CatalogTableLite[]>([]);
  const [tableName, setTableName] = useState("");
  const [columnName, setColumnName] = useState("");
  const [maskingType, setMaskingType] = useState<MaskingType>("redact");
  const [exemptRoles, setExemptRoles] = useState<Set<string>>(new Set(["admin"]));
  const [sampleValues, setSampleValues] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (connectionId === "") { setTables([]); return; }
    api.get<{ tables: CatalogTableLite[] }>(`/api/v1/catalog/${connectionId}/tables`)
      .then((data) => setTables(data.tables))
      .catch(() => setTables([]));
  }, [connectionId]);

  const selectedTable = tables.find((t) => t.table_name === tableName);

  const loadPreview = async () => {
    if (connectionId === "" || !tableName || !columnName) return;
    setPreviewLoading(true);
    setSampleValues(null);
    try {
      const result = await api.post<{ rows: (string | null)[][] }>("/api/v1/viz/query", {
        connection_id: connectionId, table_name: tableName,
        dimensions: [columnName], measures: [], filters: [],
      });
      setSampleValues(result.rows.slice(0, 5).map((r) => String(r[0] ?? "")));
    } catch (err) {
      setSampleValues(err instanceof ApiError ? [`Preview failed: ${err.message}`] : ["Preview failed."]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleExempt = (roleName: string) => {
    setExemptRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleName)) next.delete(roleName);
      else next.add(roleName);
      return next;
    });
  };

  const submit = async () => {
    if (connectionId === "" || !tableName || !columnName) return;
    await onCreate({
      connection_id: connectionId, table_name: tableName, column_name: columnName,
      masking_type: maskingType, exempt_roles: [...exemptRoles],
    });
    setFormOpen(false);
    setColumnName("");
    setSampleValues(null);
  };

  const connectionName = (id: number) => connections.find((c) => c.id === id)?.name ?? `#${id}`;

  if (loading) {
    return <div className="h-48 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-zinc-500">
          Masks column values for every role not in the exempt list — enforced in Visualize queries against the matching connection/table/column.
        </p>
        {canManage && !formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-950 bg-white rounded-lg hover:bg-zinc-200 shrink-0"
          >
            + New Masking Policy
          </button>
        )}
      </div>

      {formOpen && (
        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <select
              value={connectionId}
              onChange={(e) => { setConnectionId(e.target.value ? Number(e.target.value) : ""); setTableName(""); setColumnName(""); }}
              className="px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
            >
              <option value="">Connection...</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {tables.length > 0 ? (
              <select
                value={tableName}
                onChange={(e) => { setTableName(e.target.value); setColumnName(""); }}
                className="px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
              >
                <option value="">Table...</option>
                {tables.map((t) => <option key={t.table_name} value={t.table_name}>{t.table_name}</option>)}
              </select>
            ) : (
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Table name (not yet scanned)"
                className="px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
              />
            )}
            {selectedTable ? (
              <select
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
              >
                <option value="">Column...</option>
                {selectedTable.columns.map((c) => <option key={c.column_name} value={c.column_name}>{c.column_name}</option>)}
              </select>
            ) : (
              <input
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder="Column name"
                className="px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500">Masking type:</label>
            <select
              value={maskingType}
              onChange={(e) => setMaskingType(e.target.value as MaskingType)}
              className="px-3 py-1.5 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
            >
              {MASKING_TYPES.map((t) => <option key={t} value={t}>{maskingTypeLabel(t)}</option>)}
            </select>
            <button onClick={loadPreview} disabled={!tableName || !columnName || previewLoading} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40">
              {previewLoading ? "Loading preview..." : "Preview sample data"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Roles exempt (see real value):</label>
            {roles.filter((r) => r.is_active).map((r) => (
              <button
                key={r.id}
                onClick={() => toggleExempt(r.name)}
                className={`text-xs px-2 py-1 rounded-full border ${exemptRoles.has(r.name) ? roleColor(r.name) : "border-zinc-700 text-zinc-600"}`}
              >
                {r.name}
              </button>
            ))}
          </div>

          {sampleValues && (
            <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono">
              {sampleValues.map((v, i) => (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="text-zinc-500 w-32 truncate">{v}</span>
                  <span className="text-zinc-600">→</span>
                  <span className="text-emerald-400">{previewMask(v, maskingType)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={!connectionId || !tableName || !columnName}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40"
            >
              Save Policy
            </button>
            <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900/30">
          No masking policies defined.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {policies.map((p) => (
            <div key={p.id} className="p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-200 font-mono">{connectionName(p.connection_id)} · {p.table_name}.{p.column_name}</p>
                <p className="text-xs text-zinc-500">
                  {maskingTypeLabel(p.masking_type)} — exempt: {p.exempt_roles.length ? p.exempt_roles.join(", ") : "none"}
                </p>
              </div>
              {canManage && (
                <button onClick={() => onDelete(p.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Delete</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
