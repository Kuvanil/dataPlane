"use client";
import { classNames, formatDuration, statusColor } from "../lib/format";
import type { PipelineRun, StepName } from "../lib/types";

const STEP_ORDER: StepName[] = ["extract", "transform", "load"];

interface RunMonitorProps {
  run: PipelineRun | null;
}

export default function RunMonitor({ run }: RunMonitorProps) {
  if (!run) {
    return (
      <div className="border border-border rounded-lg p-4 bg-surface-elevated text-xs text-fg0">
        No run in progress. Trigger a run to see live status here.
      </div>
    );
  }

  const stepsByName = new Map(run.steps.map((s) => [s.step, s]));

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-elevated">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-fg-muted">Run #{run.id}</h4>
        <span className={classNames("px-2 py-0.5 rounded text-[10px] font-bold uppercase border", statusColor(run.status))}>
          {run.status}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {STEP_ORDER.map((stepName, idx) => {
          const step = stepsByName.get(stepName);
          return (
            <div key={stepName} className="flex items-center gap-2 flex-1">
              <div
                className={classNames(
                  "flex-1 rounded-lg border px-3 py-2 text-center",
                  step ? statusColor(step.status) : "bg-surface-overlay text-fg0 border-border-strong",
                )}
              >
                <div className="text-[10px] uppercase font-bold">{stepName}</div>
                <div className="text-[10px] mt-0.5">
                  {step ? step.status : "pending"}
                  {step && step.rows_processed > 0 ? ` · ${step.rows_processed} rows` : ""}
                </div>
              </div>
              {idx < STEP_ORDER.length - 1 && <span className="text-fg-subtle">→</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs text-fg-subtle">
        <div>
          <div className="text-[10px] uppercase text-fg0">Trigger</div>
          <div className="text-fg-muted">{run.trigger}{run.parent_run_id ? ` (from #${run.parent_run_id})` : ""}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-fg0">Rows processed</div>
          <div className="text-fg-muted">{run.rows_processed}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-fg0">Duration</div>
          <div className="text-fg-muted">{formatDuration(run.started_at, run.finished_at)}</div>
        </div>
      </div>

      {run.retry_count > 0 && (
        <p className="mt-3 text-[11px] text-amber-300">Retried {run.retry_count} time(s).</p>
      )}

      {run.error_message && (
        <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 whitespace-pre-wrap">
          {run.error_message}
        </div>
      )}
    </div>
  );
}
