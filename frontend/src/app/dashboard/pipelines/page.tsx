"use client";
/**
 * Pipelines — pipeline management page (Pipelines_tasks Task #7).
 *
 * Replaces the pre-TRD "Visual Transformation Studio" (ReactFlow ad-hoc
 * graph executor) with a proper pipeline management workspace: create
 * from a published Schema Mapper mapping, schedule on a cron, configure
 * retry, trigger/monitor runs, and view/re-run history. The legacy
 * POST /pipelines/execute endpoint remains on the backend for any
 * existing programmatic callers, but is no longer surfaced in this UI.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { usePipelines } from "./hooks/usePipelines";
import { classNames, formatRelativeTime } from "./lib/format";
import type { RunTrigger } from "./lib/types";

import PipelineList from "./components/PipelineList";
import ScheduleEditor from "./components/ScheduleEditor";
import RunMonitor from "./components/RunMonitor";
import RunHistory from "./components/RunHistory";
import Toast from "./components/Toast";

export default function PipelinesPage() {
  const router = useRouter();
  const p = usePipelines();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [checkingDrift, setCheckingDrift] = useState(false);

  useEffect(() => {
    if (p.detailError && p.detailError.toLowerCase().includes("not authenticated")) {
      router.push("/login");
    }
  }, [p.detailError, router]);

  useEffect(() => {
    if (selectedId !== null) {
      void p.load(selectedId);
      void p.fetchRuns(selectedId);
      p.stopPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const pipeline = p.pipeline;
  const canManage = p.role === "admin" || p.role === "analyst";
  const canDelete = p.role === "admin";

  const handleRun = async () => {
    if (!pipeline) return;
    setRunning(true);
    try {
      await p.runPipeline(pipeline.id);
    } catch {
      // toast already shown by hook
    } finally {
      setRunning(false);
    }
  };

  const handleCheckDrift = async () => {
    if (!pipeline) return;
    setCheckingDrift(true);
    try {
      await p.checkDrift(pipeline.id);
    } catch {
      // toast already shown by hook
    } finally {
      setCheckingDrift(false);
    }
  };

  const handleDelete = async () => {
    if (!pipeline) return;
    if (!confirm(`Delete pipeline "${pipeline.name}"? This removes its schedule, retry policy, and run history.`)) return;
    await p.deletePipeline(pipeline.id);
    setSelectedId(null);
  };

  const handleRerun = async (runId: number) => {
    if (!pipeline) return;
    await p.rerunPipeline(pipeline.id, runId);
  };

  const handleFilterChange = (filters: { status?: string; trigger?: RunTrigger }) => {
    if (!pipeline) return;
    void p.fetchRuns(pipeline.id, filters);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-border bg-surface-elevated backdrop-blur-sm flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg-muted">Pipelines</h3>
          <p className="text-xs text-fg0">
            Create, schedule, run, and monitor data pipelines built on published mappings
          </p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <PipelineList
          pipelines={p.pipelines}
          total={p.total}
          hasMore={p.hasMore}
          loading={p.loading}
          loadingMore={p.loadingMore}
          listError={p.listError}
          selectedId={selectedId}
          role={p.role}
          onSelect={setSelectedId}
          onLoadMore={() => void p.loadMore()}
          onCreate={p.create}
        />

        {!pipeline ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="max-w-md text-center">
              <div className="text-5xl mb-3">🔀</div>
              <h2 className="text-lg font-semibold text-fg-muted mb-2">
                {p.detailLoading ? "Loading pipeline…" : "Select or create a pipeline"}
              </h2>
              <p className="text-sm text-fg0">
                Pick a pipeline from the list, or click <span className="text-fg-muted">+ New</span> to create one
                from a published Schema Mapper mapping.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-fg">{pipeline.name}</h2>
                  <span
                    className={classNames(
                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border",
                      pipeline.enabled
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-surface-overlay text-fg-subtle border-border-strong",
                    )}
                  >
                    {pipeline.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <p className="text-xs text-fg0 mt-1">
                  #{pipeline.id} · mapping #{pipeline.mapping_id} (v{pipeline.mapping_version_id}) · updated {formatRelativeTime(pipeline.updated_at)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void p.updatePipeline(pipeline.id, { enabled: !pipeline.enabled })}
                    className="px-3 py-1.5 text-xs font-semibold text-fg-muted border border-border-strong rounded-lg hover:bg-surface-overlay"
                  >
                    {pipeline.enabled ? "Disable" : "Enable"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCheckDrift()}
                  disabled={checkingDrift}
                  className="px-3 py-1.5 text-xs font-semibold text-fg-muted border border-border-strong rounded-lg hover:bg-surface-overlay disabled:opacity-50"
                >
                  {checkingDrift ? "Checking…" : "Check drift"}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleRun()}
                    disabled={running || !pipeline.enabled}
                    title={!pipeline.enabled ? "Enable the pipeline to run it" : undefined}
                    className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {running ? "Starting…" : "Run now"}
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    className="px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {p.drift && (
              <div
                className={classNames(
                  "text-xs rounded-lg px-3 py-2 border",
                  p.drift.has_drift
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
                )}
              >
                {p.drift.message}
                {p.drift.has_drift && p.drift.changed_tables.length > 0 && (
                  <> — affected tables: {p.drift.changed_tables.join(", ")}</>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ScheduleEditor
                pipeline={pipeline}
                role={p.role}
                onSaveSchedule={(input) => p.upsertSchedule(pipeline.id, input)}
                onDeleteSchedule={() => p.deleteSchedule(pipeline.id)}
                onToggleSchedule={(enabled) => p.toggleSchedule(pipeline.id, enabled)}
                onSaveRetryPolicy={(input) => p.upsertRetryPolicy(pipeline.id, input)}
              />
              <RunMonitor run={p.activeRun} />
            </div>

            <RunHistory
              runs={p.runs}
              total={p.runsTotal}
              hasMore={p.runsHasMore}
              loading={p.runsLoading}
              role={p.role}
              onFilterChange={handleFilterChange}
              onRerun={(runId) => void handleRerun(runId)}
            />
          </div>
        )}
      </div>

      <Toast toast={p.toast} onDismiss={p.clearToast} />
    </div>
  );
}
