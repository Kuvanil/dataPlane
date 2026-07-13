"use client";
import { useState } from "react";

/** Minimal collapsible JSON tree viewer — used for metadata/before/after fields. */
export default function JsonViewer({ data, label }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(true);

  if (data === null || data === undefined) {
    return <span className="text-zinc-500 text-xs italic">null</span>;
  }

  if (typeof data !== "object") {
    return <span className="text-zinc-300 text-xs font-mono">{JSON.stringify(data)}</span>;
  }

  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);

  if (entries.length === 0) {
    return <span className="text-zinc-500 text-xs font-mono">{Array.isArray(data) ? "[]" : "{}"}</span>;
  }

  return (
    <div className="text-xs font-mono">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-zinc-400 hover:text-zinc-200"
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {label ?? (Array.isArray(data) ? `Array(${entries.length})` : `Object`)}
      </button>
      {open && (
        <div className="ml-4 border-l border-zinc-800 pl-3 mt-1 flex flex-col gap-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 items-start">
              <span className="text-violet-400">{key}:</span>
              {typeof value === "object" && value !== null ? (
                <JsonViewer data={value} />
              ) : (
                <span className="text-zinc-300">{JSON.stringify(value)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
