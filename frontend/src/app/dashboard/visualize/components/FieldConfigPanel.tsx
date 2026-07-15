"use client";
import { classNames } from "../lib/format";
import type { Aggregation, CatalogTableRef, MeasureSpec } from "../lib/types";

const AGGREGATIONS: Aggregation[] = ["sum", "avg", "count", "min", "max"];

interface FieldConfigPanelProps {
  catalogTables: CatalogTableRef[];
  catalogLoading: boolean;
  tableName: string | null;
  onTableChange: (name: string) => void;
  dimensions: string[];
  onDimensionsChange: (dims: string[]) => void;
  measures: MeasureSpec[];
  onMeasuresChange: (measures: MeasureSpec[]) => void;
}

export default function FieldConfigPanel({
  catalogTables, catalogLoading, tableName, onTableChange,
  dimensions, onDimensionsChange, measures, onMeasuresChange,
}: FieldConfigPanelProps) {
  const selectedTable = catalogTables.find((t) => t.table_name === tableName) ?? null;
  const columns = selectedTable?.columns ?? [];

  const toggleDimension = (field: string) => {
    onDimensionsChange(
      dimensions.includes(field) ? dimensions.filter((d) => d !== field) : [...dimensions, field],
    );
  };

  const addMeasure = () => {
    if (columns.length === 0) return;
    onMeasuresChange([...measures, { field: columns[0].column_name, aggregation: "sum" }]);
  };

  const updateMeasure = (index: number, patch: Partial<MeasureSpec>) => {
    onMeasuresChange(measures.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeMeasure = (index: number) => {
    onMeasuresChange(measures.filter((_, i) => i !== index));
  };

  if (catalogLoading) {
    return <div className="text-xs text-fg0">Loading catalog…</div>;
  }

  if (catalogTables.length === 0) {
    return (
      <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
        No catalog found for this connection. Scan it in{" "}
        <a href="/dashboard/schema" className="underline">Schema Intel</a> first.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="text-xs text-fg-subtle">
        Table
        <select
          value={tableName ?? ""}
          onChange={(e) => onTableChange(e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500"
        >
          {catalogTables.map((t) => (
            <option key={t.id} value={t.table_name}>{t.table_name}</option>
          ))}
        </select>
      </label>

      <div>
        <div className="text-xs text-fg-subtle mb-1.5">Dimensions (group by)</div>
        <div className="flex flex-wrap gap-1.5">
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleDimension(c.column_name)}
              className={classNames(
                "px-2 py-1 text-[11px] rounded-lg border",
                dimensions.includes(c.column_name)
                  ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                  : "border-border-strong text-fg-subtle hover:bg-surface-overlay",
              )}
            >
              {c.column_name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-fg-subtle">Measures</span>
          <button
            type="button"
            onClick={addMeasure}
            className="text-[11px] text-blue-400 hover:text-blue-300"
          >
            + Add measure
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {measures.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={m.aggregation}
                onChange={(e) => updateMeasure(i, { aggregation: e.target.value as Aggregation })}
                className="px-2 py-1.5 text-xs rounded-lg bg-surface-overlay border border-border-strong text-fg-muted"
              >
                {AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select
                value={m.field}
                onChange={(e) => updateMeasure(i, { field: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-surface-overlay border border-border-strong text-fg-muted"
              >
                {columns.map((c) => <option key={c.id} value={c.column_name}>{c.column_name}</option>)}
              </select>
              <button
                type="button"
                onClick={() => removeMeasure(i)}
                aria-label="Remove measure"
                className="text-fg0 hover:text-red-400 text-xs px-1"
              >
                ✕
              </button>
            </div>
          ))}
          {measures.length === 0 && (
            <p className="text-[11px] text-fg0">No measures yet — add one to aggregate values.</p>
          )}
        </div>
      </div>
    </div>
  );
}
