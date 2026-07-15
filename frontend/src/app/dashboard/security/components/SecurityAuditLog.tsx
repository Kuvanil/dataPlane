"use client";
import Link from "next/link";
import type { AuditSearchResponse } from "../lib/types";
import { formatTimestamp } from "../lib/format";

interface SecurityAuditLogProps {
  audit: AuditSearchResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function SecurityAuditLog({ audit, loading, onRefresh }: SecurityAuditLogProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-surface-elevated border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  const events = audit?.events ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-fg0">
          {audit?.total ?? 0} security event(s) — role/permission/policy changes only (module=security).
        </p>
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
          <Link href="/dashboard/audit" className="text-xs text-fg0 hover:text-fg-muted">Full Audit Trail →</Link>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="p-6 text-center text-sm text-fg0 rounded-xl border border-border bg-surface-elevated">
          No security events recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-background/60">
                <th className="p-2 font-semibold text-fg-subtle">Time</th>
                <th className="p-2 font-semibold text-fg-subtle">Actor</th>
                <th className="p-2 font-semibold text-fg-subtle">Action</th>
                <th className="p-2 font-semibold text-fg-subtle">Target</th>
                <th className="p-2 font-semibold text-fg-subtle">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/60 hover:bg-surface-overlay">
                  <td className="p-2 text-fg0 whitespace-nowrap">{formatTimestamp(e.created_at)}</td>
                  <td className="p-2 text-fg-muted">{e.actor}</td>
                  <td className="p-2 font-mono text-fg-muted">{e.event_type}</td>
                  <td className="p-2 text-fg-subtle">{e.target_name || e.target_type || "—"}</td>
                  <td className="p-2 text-fg0 max-w-xs truncate" title={JSON.stringify(e.after_summary ?? e.before_summary ?? {})}>
                    {e.before_summary && e.after_summary
                      ? `${JSON.stringify(e.before_summary)} → ${JSON.stringify(e.after_summary)}`
                      : JSON.stringify(e.after_summary ?? e.before_summary ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
