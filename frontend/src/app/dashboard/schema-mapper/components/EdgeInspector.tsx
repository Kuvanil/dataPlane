"use client";
import { classNames, formatPercent, formatTimestamp } from "../lib/format";
import type { FieldMapping, Role, TransformationPayload } from "../lib/types";

interface EdgeInspectorProps {
  edge: FieldMapping | null;
  role: Role | null;
  canEdit: boolean;
  onEdit: (transformation: TransformationPayload) => void;
  onDelete: () => void;
}

export default function EdgeInspector({
  edge,
  role,
  canEdit,
  onEdit,
  onDelete,
}: EdgeInspectorProps) {
  if (!edge) {
    return (
      <aside
        aria-label="Edge inspector"
        className="w-72 border-l border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500"
      >
        <p className="italic">Select an edge to inspect.</p>
      </aside>
    );
  }
  const sourcesLabel = edge.sources
    .map((s) => `${s.table}.${s.column}`)
    .join(", ");
  return (
    <aside
      aria-label="Edge inspector"
      className="w-72 border-l border-zinc-800 bg-zinc-900/30 flex flex-col"
    >
      <div className="p-4 border-b border-zinc-800">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          Target
        </div>
        <div className="mt-1 text-sm font-mono text-indigo-300">
          {edge.target.table}.{edge.target.column}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          {edge.target.type ?? "?"}{" "}
          {edge.target.primary_key ? "· PK" : ""}{" "}
          {edge.target.nullable === false ? "· NOT NULL" : ""}
        </div>
      </div>
      <div className="p-4 border-b border-zinc-800">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          Source{edge.sources.length > 1 ? "s" : ""} ({edge.sources.length})
        </div>
        <ul className="mt-1 text-xs text-blue-300 font-mono space-y-0.5">
          {edge.sources.map((s, i) => (
            <li key={i}>
              {s.table}.{s.column}
              <span className="text-zinc-500 ml-1">({s.type ?? "?"})</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-4 border-b border-zinc-800">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold flex items-center justify-between">
          <span>Transformation</span>
          <span
            className={classNames(
              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
              edge.origin === "ai_accepted"
                ? "bg-violet-500/15 text-violet-300"
                : "bg-zinc-800 text-zinc-400",
            )}
          >
            {edge.origin}
            {edge.ai_confidence != null && ` · ${formatPercent(edge.ai_confidence)}`}
          </span>
        </div>
        <pre className="mt-2 text-[11px] font-mono text-zinc-300 bg-zinc-950/50 rounded p-2 border border-zinc-800 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(edge.transformation, null, 2)}
        </pre>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(edge.transformation)}
              className="flex-1 px-2 py-1.5 text-[11px] font-semibold rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25"
              aria-label="Edit transformation"
            >
              ✎ Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="px-2 py-1.5 text-[11px] font-semibold rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25"
              aria-label="Delete edge"
            >
              ✕ Delete
            </button>
          </div>
        )}
      </div>
      <div className="p-4 text-[10px] text-zinc-500 space-y-1">
        <div>
          <span className="text-zinc-600">ID:</span> #{edge.id}
        </div>
        {edge.audit.created_by && (
          <div>
            <span className="text-zinc-600">Created by:</span>{" "}
            {edge.audit.created_by} · {formatTimestamp(edge.audit.created_at)}
          </div>
        )}
        {edge.audit.updated_by && edge.audit.updated_by !== edge.audit.created_by && (
          <div>
            <span className="text-zinc-600">Updated by:</span>{" "}
            {edge.audit.updated_by} · {formatTimestamp(edge.audit.updated_at)}
          </div>
        )}
        {!canEdit && role && (
          <div className="mt-2 text-amber-400 italic">
            Your role ({role}) cannot edit this edge.
          </div>
        )}
      </div>
    </aside>
  );
}
