"use client";
import type { ConnectorRef } from "../lib/types";

interface ConnectionPickerProps {
  connections: ConnectorRef[];
  loading: boolean;
  connectionId: number | null;
  onChange: (id: number) => void;
}

export default function ConnectionPicker({
  connections, loading, connectionId, onChange,
}: ConnectionPickerProps) {
  if (loading) {
    return <div className="text-xs text-fg0">Loading connections…</div>;
  }
  if (connections.length === 0) {
    return <div className="text-xs text-fg0">No connections configured yet.</div>;
  }
  return (
    <select
      value={connectionId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500"
      aria-label="Select connection"
    >
      {connections.map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
      ))}
    </select>
  );
}
