"use client";
import { Connection } from "../lib/types";

export default function ConnectionPicker({
  connections,
  value,
  onChange,
}: {
  connections: Connection[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-blue-500"
    >
      <option value="" disabled>Select a connection…</option>
      {connections.map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
      ))}
    </select>
  );
}
