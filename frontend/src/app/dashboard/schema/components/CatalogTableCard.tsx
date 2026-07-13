"use client";
import { useState } from "react";
import { classNames, classificationColor, formatPercent, formatRelativeTime, methodLabel } from "../lib/format";
import type { CatalogColumn, CatalogTable, ClassificationLabel, Role } from "../lib/types";

interface CatalogTableCardProps {
  table: CatalogTable;
  role: Role | null;
  onOverride: (columnId: number, label: string, level: string) => Promise<void>;
}

export default function CatalogTableCard({ table, role, onOverride }: CatalogTableCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [overrideColumn, setOverrideColumn] = useState<CatalogColumn | null>(null);
  const canOverride = role === "admin" || role === "analyst";

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs">{expanded ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-zinc-200">{table.table_name}</span>
          <span className="text-[10px] text-zinc-500">{table.columns.length} columns</span>
        </div>
        <span className="text-[10px] text-zinc-500">scanned {formatRelativeTime(table.last_scanned_at)}</span>
      </button>

      {expanded && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-zinc-500 border-t border-b border-zinc-800">
              <th className="text-left px-3 py-2">Column</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Classification</th>
              <th className="text-left px-3 py-2">Null rate</th>
              <th className="text-left px-3 py-2">Distinct</th>
              <th className="text-left px-3 py-2">Min / Max</th>
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr key={col.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/20">
                <td className="px-3 py-2 text-zinc-200">
                  {col.column_name}
                  {col.is_primary_key && <span className="ml-1 text-[9px] text-blue-400">PK</span>}
                </td>
                <td className="px-3 py-2 text-zinc-400">{col.data_type ?? "—"}</td>
                <td className="px-3 py-2">
                  {col.classification ? (
                    <span
                      className={classNames(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold border",
                        classificationColor(col.classification.label),
                      )}
                      title={`confidence ${formatPercent(col.classification.confidence)} (${methodLabel(col.classification.method)})`}
                    >
                      {col.classification.label} · {formatPercent(col.classification.confidence)}
                    </span>
                  ) : (
                    <span className="text-zinc-600">not classified</span>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {col.profile ? formatPercent(col.profile.null_rate) : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {col.profile?.distinct_count ?? "—"}
                </td>
                <td className="px-3 py-2 text-zinc-400 max-w-[160px] truncate" title={
                  col.profile ? `${col.profile.min_value ?? "—"} / ${col.profile.max_value ?? "—"}` : undefined
                }>
                  {col.profile ? `${col.profile.min_value ?? "—"} / ${col.profile.max_value ?? "—"}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {canOverride && (
                    <button
                      type="button"
                      onClick={() => setOverrideColumn(col)}
                      className="text-[11px] text-blue-400 hover:text-blue-300"
                    >
                      Override
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {overrideColumn && (
        <OverrideModal
          column={overrideColumn}
          onClose={() => setOverrideColumn(null)}
          onSubmit={async (label, level) => {
            await onOverride(overrideColumn.id, label, level);
            setOverrideColumn(null);
          }}
        />
      )}
    </div>
  );
}

function OverrideModal({
  column, onClose, onSubmit,
}: {
  column: CatalogColumn;
  onClose: () => void;
  onSubmit: (label: string, level: string) => Promise<void>;
}) {
  const [label, setLabel] = useState<ClassificationLabel>(column.classification?.label ?? "Public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelForLabel = (l: string) => (l === "PII" ? "High" : l === "Sensitive" ? "Medium" : "Low");

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(label, levelForLabel(label));
    } catch {
      setError("Failed to save override.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Override classification"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Override classification</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Column <span className="text-zinc-300">{column.column_name}</span> — currently{" "}
          {column.classification
            ? `${column.classification.label} (${methodLabel(column.classification.method)})`
            : "not classified"}.
        </p>
        <label className="text-xs text-zinc-400">
          New classification
          <select
            value={label}
            onChange={(e) => setLabel(e.target.value as ClassificationLabel)}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
          >
            <option value="PII">PII (High)</option>
            <option value="Sensitive">Sensitive (Medium)</option>
            <option value="Public">Public (Low)</option>
          </select>
        </label>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save override"}
          </button>
        </div>
      </div>
    </div>
  );
}
