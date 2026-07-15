"use client";
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import type { AuditEvent } from "../lib/types";

interface ConnectorAuditLogProps {
  connectorId: number;
  connectorName: string;
  onClose: () => void;
}

export default function ConnectorAuditLog({ connectorId, connectorName, onClose }: ConnectorAuditLogProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AuditEvent[]>(`/api/v1/audit?target_type=connection&target_id=${connectorId}&page_size=20`)
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(err => {
        // If the audit API doesn't support this filter, show empty state
        console.error("Failed to fetch audit events:", err);
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, [connectorId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-5 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-fg-muted">Activity — {connectorName}</h3>
            <p className="text-xs text-fg0">Recent audit events for this connector</p>
          </div>
          <button onClick={onClose} className="text-fg0 hover:text-fg-muted text-xs">✕ Close</button>
        </div>

        <div className="overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-xs text-fg0">
                <span className="w-3 h-3 border border-border-strong border-t-transparent rounded-full animate-spin" />
                Loading activity...
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-fg0">
              <span className="text-2xl mb-2">📋</span>
              <p className="text-sm">No audit events found for this connector.</p>
              <p className="text-xs mt-1">Events appear here when connections are created, tested, edited, or deleted.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2 font-semibold text-fg-subtle">Timestamp</th>
                  <th className="p-2 font-semibold text-fg-subtle">Action</th>
                  <th className="p-2 font-semibold text-fg-subtle">Actor</th>
                  <th className="p-2 font-semibold text-fg-subtle">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, i) => (
                  <tr key={event.id ?? i} className="border-b border-border/60 hover:bg-surface-overlay">
                    <td className="p-2 text-fg-subtle whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2">
                      <span className="font-semibold text-fg-muted">{event.action}</span>
                    </td>
                    <td className="p-2 text-fg-subtle">{event.actor}</td>
                    <td className="p-2 text-fg0 max-w-[200px] truncate">{event.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}