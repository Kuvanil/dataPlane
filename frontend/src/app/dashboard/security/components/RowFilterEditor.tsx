"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  ConnectorRef, FilterCondition, FilterOperator, RowAccessPolicy, Role, RoleRecord,
} from "../lib/types";
import { FILTER_OPERATORS } from "../lib/types";
import { roleColor } from "../lib/format";

interface CatalogColumnLite {
  column_name: string;
}
interface CatalogTableLite {
  table_name: string;
  columns: CatalogColumnLite[];
}

interface RowFilterEditorProps {
  role: Role | null;
  connections: ConnectorRef[];
  policies: RowAccessPolicy[];
  loading: boolean;
  roles: RoleRecord[];
  onCreate: (payload: {
    connection_id: number; table_name: string;
    filter_conditions: FilterCondition[]; applies_to_roles: string[];
  }) => Promise<void>;
  onDelete: (policyId: number) => Promise<void>;
}

const emptyCondition = (): FilterCondition => ({ field: "", operator: "=", value: "", logic: "AND" });

export default function RowFilterEditor({
  role, connections, policies, loading, roles, onCreate, onDelete,
}: RowFilterEditorProps) {
  const canManage = role === "admin";
  const [connectionId, setConnectionId] = useState<number | "">("");
  const [tables, setTables] = useState<CatalogTableLite[]>([]);
  const [tableName, setTableName] = useState("");
  const [conditions, setConditions] = useState<FilterCondition[]>([emptyCondition()]);
  const [appliesToRoles, setAppliesToRoles] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [rowCounts, setRowCounts] = useState<{ before: number; after: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (connectionId === "") { setTables([]); return; }
    api.get<{ tables: CatalogTableLite[] }>(`/api/v1/catalog/${connectionId}/tables`)
      .then((data) => setTables(data.tables))
      .catch(() => setTables([]));
  }, [connectionId]);

  const selectedTable = tables.find((t) => t.table_name === tableName);

  const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addCondition = () => setConditions((prev) => [...prev, emptyCondition()]);
  const removeCondition = (idx: number) => setConditions((prev) => prev.filter((_, i) => i !== idx));

  const toggleRole = (roleName: string) => {
    setAppliesToRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleName)) next.delete(roleName);
      else next.add(roleName);
      return next;
    });
  };

  const loadPreview = async () => {
    if (connectionId === "" || !tableName) return;
    setPreviewLoading(true);
    setRowCounts(null);
    try {
      const [unfiltered, filtered] = await Promise.all([
        api.post<{ row_count: number }>("/api/v1/viz/query", {
          connection_id: connectionId, table_name: tableName,
          dimensions: [], measures: [{ field: selectedTable?.columns[0]?.column_name ?? "*", aggregation: "count", label: "n" }],
          filters: [],
        }),
        api.post<{ row_count: number }>("/api/v1/viz/query", {
          connection_id: connectionId, table_name: tableName,
          dimensions: [], measures: [{ field: selectedTable?.columns[0]?.column_name ?? "*", aggregation: "count", label: "n" }],
          filters: conditions
            .filter((c) => c.field && c.operator === "=" && !Array.isArray(c.value))
            .map((c) => ({ field: c.field, operator: "eq", value: c.value })),
        }),
      ]);
      setRowCounts({ before: unfiltered.row_count, after: filtered.row_count });
    } catch {
      setRowCounts(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const submit = async () => {
    if (connectionId === "" || !tableName) return;
    const valid = conditions.filter((c) => c.field && c.value !== "");
    if (valid.length === 0) return;
    await onCreate({
      connection_id: connectionId, table_name: tableName,
      filter_conditions: valid, applies_to_roles: [...appliesToRoles],
    });
    setFormOpen(false);
    setConditions([emptyCondition()]);
    setAppliesToRoles(new Set());
    setRowCounts(null);
  };

  const connectionName = (id: number) => connections.find((c) => c.id === id)?.name ?? `#${id}`;

  if (loading) {
    return <div className="h-48 rounded-xl bg-surface-elevated border border-border animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-fg0">
          Restricts which rows a role sees — ANDed onto any filters a user applies themselves in Visualize.
        </p>
        {canManage && !formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-fg bg-white rounded-lg hover:bg-surface shrink-0"
          >
            + New Row Filter
          </button>
        )}
      </div>

      {formOpen && (
        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={connectionId}
              onChange={(e) => { setConnectionId(e.target.value ? Number(e.target.value) : ""); setTableName(""); }}
              className="px-3 py-2 text-sm rounded-lg bg-background border border-border-strong text-fg-muted"
            >
              <option value="">Connection...</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {tables.length > 0 ? (
              <select
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg bg-background border border-border-strong text-fg-muted"
              >
                <option value="">Table...</option>
                {tables.map((t) => <option key={t.table_name} value={t.table_name}>{t.table_name}</option>)}
              </select>
            ) : (
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Table name (not yet scanned)"
                className="px-3 py-2 text-sm rounded-lg bg-background border border-border-strong text-fg-muted"
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            {conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {idx > 0 && (
                  <select
                    value={cond.logic}
                    onChange={(e) => updateCondition(idx, { logic: e.target.value as "AND" | "OR" })}
                    className="px-2 py-1.5 text-xs rounded-lg bg-background border border-border-strong text-fg-subtle w-16"
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                )}
                {selectedTable ? (
                  <select
                    value={cond.field}
                    onChange={(e) => updateCondition(idx, { field: e.target.value })}
                    className="px-2 py-1.5 text-xs rounded-lg bg-background border border-border-strong text-fg-muted flex-1"
                  >
                    <option value="">field...</option>
                    {selectedTable.columns.map((c) => <option key={c.column_name} value={c.column_name}>{c.column_name}</option>)}
                  </select>
                ) : (
                  <input
                    value={cond.field}
                    onChange={(e) => updateCondition(idx, { field: e.target.value })}
                    placeholder="field"
                    className="px-2 py-1.5 text-xs rounded-lg bg-background border border-border-strong text-fg-muted flex-1"
                  />
                )}
                <select
                  value={cond.operator}
                  onChange={(e) => updateCondition(idx, { operator: e.target.value as FilterOperator })}
                  className="px-2 py-1.5 text-xs rounded-lg bg-background border border-border-strong text-fg-muted w-24"
                >
                  {FILTER_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
                <input
                  value={Array.isArray(cond.value) ? cond.value.join(",") : cond.value}
                  onChange={(e) => updateCondition(idx, {
                    value: cond.operator === "in" || cond.operator === "not in"
                      ? e.target.value.split(",").map((v) => v.trim())
                      : e.target.value,
                  })}
                  placeholder={cond.operator === "in" || cond.operator === "not in" ? "v1,v2,v3" : "value"}
                  className="px-2 py-1.5 text-xs rounded-lg bg-background border border-border-strong text-fg-muted flex-1"
                />
                {conditions.length > 1 && (
                  <button onClick={() => removeCondition(idx)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                )}
              </div>
            ))}
            <button onClick={addCondition} className="text-xs text-blue-400 hover:text-blue-300 self-start">+ Add condition</button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-fg0">Applies to roles:</label>
            {roles.filter((r) => r.is_active).map((r) => (
              <button
                key={r.id}
                onClick={() => toggleRole(r.name)}
                className={`text-xs px-2 py-1 rounded-full border ${appliesToRoles.has(r.name) ? roleColor(r.name) : "border-border-strong text-fg-subtle"}`}
              >
                {r.name}
              </button>
            ))}
          </div>

          <button onClick={loadPreview} disabled={!tableName || previewLoading} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 self-start">
            {previewLoading ? "Loading preview..." : "Preview row count impact"}
          </button>
          {rowCounts && (
            <p className="text-xs text-fg-subtle">
              {rowCounts.before} row(s) unfiltered → <span className="text-emerald-400">{rowCounts.after} row(s)</span> after this filter (equality conditions only in preview)
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={!connectionId || !tableName || appliesToRoles.size === 0}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40"
            >
              Save Filter
            </button>
            <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-fg-subtle bg-surface-overlay hover:bg-surface-overlay rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="p-6 text-center text-sm text-fg0 rounded-xl border border-border bg-surface-elevated">
          No row access filters defined.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {policies.map((p) => (
            <div key={p.id} className="p-3 rounded-xl border border-border bg-surface-elevated flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-fg-muted font-mono">{connectionName(p.connection_id)} · {p.table_name}</p>
                <p className="text-xs text-fg0">
                  {p.filter_conditions.map((c, i) => `${i > 0 ? ` ${c.logic ?? "AND"} ` : ""}${c.field} ${c.operator} ${Array.isArray(c.value) ? `(${c.value.join(", ")})` : c.value}`).join("")}
                  {" — applies to: "}{p.applies_to_roles.join(", ") || "none"}
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
