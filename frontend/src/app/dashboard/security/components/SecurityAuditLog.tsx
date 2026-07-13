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
          <div key={i} className="h-12 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const events = audit?.events ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-zinc-500">
          {audit?.total ?? 0} security event(s) — role/permission/policy changes only (module=security).
        </p>
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
          <Link href="/dashboard/audit" className="text-xs text-zinc-500 hover:text-zinc-300">Full Audit Trail →</Link>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900/30">
          No security events recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60">
                <th className="p-2 font-semibold text-zinc-400">Time</th>
                <th className="p-2 font-semibold text-zinc-400">Actor</th>
                <th className="p-2 font-semibold text-zinc-400">Action</th>
                <th className="p-2 font-semibold text-zinc-400">Target</th>
                <th className="p-2 font-semibold text-zinc-400">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/10">
                  <td className="p-2 text-zinc-500 whitespace-nowrap">{formatTimestamp(e.created_at)}</td>
                  <td className="p-2 text-zinc-300">{e.actor}</td>
                  <td className="p-2 font-mono text-zinc-200">{e.event_type}</td>
                  <td className="p-2 text-zinc-400">{e.target_name || e.target_type || "—"}</td>
                  <td className="p-2 text-zinc-500 max-w-xs truncate" title={JSON.stringify(e.after_summary ?? e.before_summary ?? {})}>
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
