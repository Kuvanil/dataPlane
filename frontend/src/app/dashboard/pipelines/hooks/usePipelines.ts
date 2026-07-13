"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type {
  DriftValidation,
  Paginated,
  Pipeline,
  PipelineRun,
  RerunResponse,
  RetryPolicy,
  Role,
  RunTrigger,
  RunTriggerResponse,
  Schedule,
} from "../lib/types";

const PAGE_SIZE = 50;
const RUN_POLL_INTERVAL_MS = 4000; // NFR: monitoring updates within ~5s of state change

interface Toast {
  message: string;
  kind: "success" | "error";
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

export function usePipelines() {
  const [role, setRole] = useState<Role | null>(null);

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);

  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [drift, setDrift] = useState<DriftValidation | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<{ role: Role }>("/api/v1/auth/me");
        setRole(me.role);
      } catch {
        setRole(null);
      }
    })();
  }, []);

  const showError = useCallback((message: string) => setToast({ message, kind: "error" }), []);
  const showSuccess = useCallback((message: string) => setToast({ message, kind: "success" }), []);
  const clearToast = useCallback(() => setToast(null), []);

  // ── List ──────────────────────────────────────────────────────────

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const data = await api.get<Paginated<Pipeline>>(
        `/api/v1/pipelines/?limit=${PAGE_SIZE}&offset=0`,
      );
      setPipelines(data.items);
      setTotal(data.total);
      setHasMore(data.has_more);
    } catch (err) {
      setListError(errorMessage(err, "Backend unreachable."));
      setPipelines([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<Paginated<Pipeline>>(
        `/api/v1/pipelines/?limit=${PAGE_SIZE}&offset=${pipelines.length}`,
      );
      setPipelines((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(data.has_more);
    } catch (err) {
      showError(errorMessage(err, "Failed to load more pipelines."));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, pipelines.length, showError]);

  useEffect(() => {
    void fetchPipelines();
  }, [fetchPipelines]);

  // ── Detail ────────────────────────────────────────────────────────

  const load = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setDrift(null);
    try {
      const data = await api.get<Pipeline>(`/api/v1/pipelines/${id}`);
      setPipeline(data);
    } catch (err) {
      setDetailError(errorMessage(err, "Failed to load pipeline."));
      setPipeline(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const create = useCallback(
    async (input: { name: string; source_connection_id: number; target_connection_id: number; mapping_id: number }) => {
      try {
        const p = await api.post<Pipeline>("/api/v1/pipelines/", input);
        setPipelines((prev) => [p, ...prev]);
        setTotal((t) => t + 1);
        showSuccess(`Pipeline "${p.name}" created.`);
        return p;
      } catch (err) {
        showError(errorMessage(err, "Failed to create pipeline."));
        throw err;
      }
    },
    [showError, showSuccess],
  );

  const updatePipeline = useCallback(
    async (id: number, patch: { name?: string; enabled?: boolean }) => {
      try {
        const p = await api.put<Pipeline>(`/api/v1/pipelines/${id}`, patch);
        setPipeline((prev) => (prev && prev.id === id ? { ...prev, ...p } : prev));
        setPipelines((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
        return p;
      } catch (err) {
        showError(errorMessage(err, "Failed to update pipeline."));
        throw err;
      }
    },
    [showError],
  );

  const deletePipeline = useCallback(
    async (id: number) => {
      try {
        await api.delete(`/api/v1/pipelines/${id}`);
        setPipelines((prev) => prev.filter((p) => p.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        setPipeline((prev) => (prev && prev.id === id ? null : prev));
        showSuccess("Pipeline deleted.");
      } catch (err) {
        showError(errorMessage(err, "Failed to delete pipeline."));
        throw err;
      }
    },
    [showError, showSuccess],
  );

  // ── Drift preview ─────────────────────────────────────────────────

  const checkDrift = useCallback(async (id: number) => {
    try {
      const d = await api.get<DriftValidation>(`/api/v1/pipelines/${id}/drift`);
      setDrift(d);
      return d;
    } catch (err) {
      showError(errorMessage(err, "Failed to check drift."));
      throw err;
    }
  }, [showError]);

  // ── Runs ──────────────────────────────────────────────────────────

  const fetchRuns = useCallback(
    async (pipelineId: number, filters?: { status?: string; trigger?: RunTrigger }) => {
      setRunsLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: "0" });
        if (filters?.status) params.set("status", filters.status);
        if (filters?.trigger) params.set("trigger", filters.trigger);
        const data = await api.get<Paginated<PipelineRun>>(
          `/api/v1/pipelines/${pipelineId}/runs?${params.toString()}`,
        );
        setRuns(data.items);
        setRunsTotal(data.total);
        setRunsHasMore(data.has_more);
      } catch (err) {
        showError(errorMessage(err, "Failed to load run history."));
        setRuns([]);
      } finally {
        setRunsLoading(false);
      }
    },
    [showError],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollRun = useCallback(
    (pipelineId: number, runId: number) => {
      stopPolling();
      const tick = async () => {
        try {
          const run = await api.get<PipelineRun>(`/api/v1/pipelines/${pipelineId}/runs/${runId}`);
          setActiveRun(run);
          if (["succeeded", "failed"].includes(run.status)) {
            stopPolling();
            void fetchRuns(pipelineId);
          }
        } catch {
          stopPolling();
        }
      };
      void tick();
      pollRef.current = setInterval(tick, RUN_POLL_INTERVAL_MS);
    },
    [stopPolling, fetchRuns],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const runPipeline = useCallback(
    async (pipelineId: number) => {
      try {
        const resp = await api.post<RunTriggerResponse>(`/api/v1/pipelines/${pipelineId}/run`, {});
        showSuccess(`Run #${resp.run_id} queued.`);
        pollRun(pipelineId, resp.run_id);
        return resp;
      } catch (err) {
        showError(errorMessage(err, "Failed to start run."));
        throw err;
      }
    },
    [showError, showSuccess, pollRun],
  );

  const rerunPipeline = useCallback(
    async (pipelineId: number, runId: number) => {
      try {
        const resp = await api.post<RerunResponse>(
          `/api/v1/pipelines/${pipelineId}/runs/${runId}/rerun`, {},
        );
        showSuccess(`Re-run #${resp.new_run_id} queued (from #${runId}).`);
        pollRun(pipelineId, resp.new_run_id);
        return resp;
      } catch (err) {
        showError(errorMessage(err, "Failed to start re-run."));
        throw err;
      }
    },
    [showError, showSuccess, pollRun],
  );

  // ── Schedule + retry policy ───────────────────────────────────────

  const upsertSchedule = useCallback(
    async (pipelineId: number, input: { cron_expression: string; enabled: boolean; timezone: string }) => {
      try {
        const schedule = await api.put<Schedule>(`/api/v1/pipelines/${pipelineId}/schedule`, input);
        setPipeline((prev) => (prev && prev.id === pipelineId ? { ...prev, schedule } : prev));
        showSuccess("Schedule saved.");
        return schedule;
      } catch (err) {
        showError(errorMessage(err, "Failed to save schedule."));
        throw err;
      }
    },
    [showError, showSuccess],
  );

  const deleteSchedule = useCallback(
    async (pipelineId: number) => {
      try {
        await api.delete(`/api/v1/pipelines/${pipelineId}/schedule`);
        setPipeline((prev) => (prev && prev.id === pipelineId ? { ...prev, schedule: null } : prev));
        showSuccess("Schedule removed.");
      } catch (err) {
        showError(errorMessage(err, "Failed to remove schedule."));
        throw err;
      }
    },
    [showError, showSuccess],
  );

  const toggleSchedule = useCallback(
    async (pipelineId: number, enabled: boolean) => {
      try {
        const schedule = await api.patch<Schedule>(
          `/api/v1/pipelines/${pipelineId}/schedule/toggle?enabled=${enabled}`,
        );
        setPipeline((prev) => (prev && prev.id === pipelineId ? { ...prev, schedule } : prev));
      } catch (err) {
        showError(errorMessage(err, "Failed to toggle schedule."));
        throw err;
      }
    },
    [showError],
  );

  const upsertRetryPolicy = useCallback(
    async (pipelineId: number, input: { max_attempts: number; backoff_seconds: number }) => {
      try {
        const policy = await api.put<RetryPolicy>(`/api/v1/pipelines/${pipelineId}/retry-policy`, input);
        setPipeline((prev) => (prev && prev.id === pipelineId ? { ...prev, retry_policy: policy } : prev));
        showSuccess("Retry policy saved.");
        return policy;
      } catch (err) {
        showError(errorMessage(err, "Failed to save retry policy."));
        throw err;
      }
    },
    [showError, showSuccess],
  );

  return {
    role,
    pipelines, total, hasMore, loading, loadingMore, listError,
    fetchPipelines, loadMore, create, updatePipeline, deletePipeline,
    pipeline, detailLoading, detailError, load,
    drift, checkDrift,
    runs, runsTotal, runsHasMore, runsLoading, fetchRuns,
    activeRun, pollRun, stopPolling,
    runPipeline, rerunPipeline,
    upsertSchedule, deleteSchedule, toggleSchedule, upsertRetryPolicy,
    toast, showError, showSuccess, clearToast,
  };
}
