"use client";
import { useState } from "react";
import { classNames, formatDuration, formatTimestamp, statusColor } from "../lib/format";
import type { PipelineRun, Role, RunTrigger } from "../lib/types";

interface RunHistoryProps {
  runs: PipelineRun[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  role: Role | null;
  onFilterChange: (filters: { status?: string; trigger?: RunTrigger }) => void;
  onRerun: (runId: number) => void;
}

const STATUS_OPTIONS = ["", "pending", "running", "succeeded", "failed", "retrying"];
const TRIGGER_OPTIONS: Array<RunTrigger | ""> = ["", "manual", "scheduled", "rerun"];

export default function RunHistory({ runs, total, hasMore, loading, role, onFilterChange, onRerun }: RunHistoryProps) {
  const canRerun = role === "admin" || role === "analyst";
  const [status, setStatus] = useState("");
  const [trigger, setTrigger] = useState<RunTrigger | "">("");

  return (
    <div className="border border-border rounded-lg bg-surface-elevated overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-fg-muted">Run history{total > 0 ? ` · ${total}` : ""}</h4>
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              onFilterChange({ status: e.target.value || undefined, trigger: trigger || undefined });
            }}
            className="px-2 py-1 text-[11px] rounded bg-surface-overlay border border-border-strong text-fg-muted"
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
          </select>
          <select
            value={trigger}
            onChange={(e) => {
              const v = e.target.value as RunTrigger | "";
              setTrigger(v);
              onFilterChange({ status: status || undefined, trigger: v || undefined });
            }}
            className="px-2 py-1 text-[11px] rounded bg-surface-overlay border border-border-strong text-fg-muted"
          >
            {TRIGGER_OPTIONS.map((t) => <option key={t} value={t}>{t || "all triggers"}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-xs text-fg0">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="p-4 text-xs text-fg0">No runs yet.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-fg0 border-b border-border">
              <th className="text-left px-3 py-2">Run</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Trigger</th>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Duration</th>
              <th className="text-left px-3 py-2">Rows</th>
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-border/60 hover:bg-surface-overlay">
                <td className="px-3 py-2 text-fg-muted">
                  #{run.id}{run.parent_run_id ? <span className="text-fg0"> ← #{run.parent_run_id}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={classNames("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border", statusColor(run.status))}>
                    {run.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-fg-subtle">{run.trigger}</td>
                <td className="px-3 py-2 text-fg-subtle">{formatTimestamp(run.started_at)}</td>
                <td className="px-3 py-2 text-fg-subtle">{formatDuration(run.started_at, run.finished_at)}</td>
                <td className="px-3 py-2 text-fg-subtle">{run.rows_processed}</td>
                <td className="px-3 py-2 text-right">
                  {canRerun && ["succeeded", "failed"].includes(run.status) && (
                    <button
                      type="button"
                      onClick={() => onRerun(run.id)}
                      className="text-[11px] text-blue-400 hover:text-blue-300"
                    >
                      Re-run
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && !loading && (
        <div className="px-3 py-2 text-[11px] text-fg0 border-t border-border">
          Showing {runs.length} of {total}. Narrow the filters to see more specific runs.
        </div>
      )}
    </div>
  );
}
