"use client";
import { useEffect, useState } from "react";
import { describeCron } from "../lib/format";
import type { Pipeline, Role } from "../lib/types";

interface ScheduleEditorProps {
  pipeline: Pipeline;
  role: Role | null;
  onSaveSchedule: (input: { cron_expression: string; enabled: boolean; timezone: string }) => Promise<unknown>;
  onDeleteSchedule: () => Promise<unknown>;
  onToggleSchedule: (enabled: boolean) => Promise<unknown>;
  onSaveRetryPolicy: (input: { max_attempts: number; backoff_seconds: number }) => Promise<unknown>;
}

const CRON_PRESET_OPTIONS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 2:00 AM", value: "0 2 * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every Sunday at midnight", value: "0 0 * * 0" },
];

export default function ScheduleEditor({
  pipeline, role, onSaveSchedule, onDeleteSchedule, onToggleSchedule, onSaveRetryPolicy,
}: ScheduleEditorProps) {
  const canEdit = role === "admin" || role === "analyst";
  const schedule = pipeline.schedule ?? null;
  const retryPolicy = pipeline.retry_policy ?? null;

  const [cron, setCron] = useState(schedule?.cron_expression ?? "0 2 * * *");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "UTC");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [maxAttempts, setMaxAttempts] = useState(retryPolicy?.max_attempts ?? 3);
  const [backoffSeconds, setBackoffSeconds] = useState(retryPolicy?.backoff_seconds ?? 60);
  const [savingRetry, setSavingRetry] = useState(false);

  useEffect(() => {
    setCron(schedule?.cron_expression ?? "0 2 * * *");
    setTimezone(schedule?.timezone ?? "UTC");
  }, [schedule?.cron_expression, schedule?.timezone]);

  useEffect(() => {
    setMaxAttempts(retryPolicy?.max_attempts ?? 3);
    setBackoffSeconds(retryPolicy?.backoff_seconds ?? 60);
  }, [retryPolicy?.max_attempts, retryPolicy?.backoff_seconds]);

  const saveSchedule = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveSchedule({ cron_expression: cron, enabled: schedule?.enabled ?? true, timezone });
    } catch {
      setError("Failed to save schedule — check the cron expression.");
    } finally {
      setSaving(false);
    }
  };

  const saveRetryPolicy = async () => {
    setSavingRetry(true);
    try {
      await onSaveRetryPolicy({ max_attempts: maxAttempts, backoff_seconds: backoffSeconds });
    } finally {
      setSavingRetry(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-elevated">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-fg-muted">Schedule</h4>
        {schedule && (
          <label className="flex items-center gap-2 text-xs text-fg-subtle">
            <input
              type="checkbox"
              checked={schedule.enabled}
              disabled={!canEdit}
              onChange={(e) => void onToggleSchedule(e.target.checked)}
              className="accent-blue-500"
            />
            enabled
          </label>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-fg-subtle">
          Cron expression
          <input
            type="text"
            value={cron}
            disabled={!canEdit}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 2 * * *"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg font-mono focus:outline-none focus:border-blue-500 disabled:opacity-60"
          />
        </label>
        <p className="text-[11px] text-fg0">Preview: {describeCron(cron)}</p>

        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESET_OPTIONS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setCron(preset.value)}
                className="px-2 py-1 text-[10px] rounded border border-border-strong text-fg-subtle hover:text-fg-muted hover:bg-surface-overlay"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        <label className="text-xs text-fg-subtle">
          Timezone
          <input
            type="text"
            value={timezone}
            disabled={!canEdit}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500 disabled:opacity-60"
          />
        </label>

        {schedule?.next_run_at && (
          <p className="text-[11px] text-fg0">Next run: {new Date(schedule.next_run_at).toLocaleString()}</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        {canEdit && (
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => void saveSchedule()}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : schedule ? "Update schedule" : "Create schedule"}
            </button>
            {schedule && (
              <button
                type="button"
                onClick={() => void onDeleteSchedule()}
                className="px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10"
              >
                Remove schedule
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <h4 className="text-sm font-semibold text-fg-muted mb-3">Retry policy</h4>
        <div className="flex gap-3">
          <label className="text-xs text-fg-subtle flex-1">
            Max attempts
            <input
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              disabled={!canEdit}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500 disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-fg-subtle flex-1">
            Backoff (seconds)
            <input
              type="number"
              min={1}
              value={backoffSeconds}
              disabled={!canEdit}
              onChange={(e) => setBackoffSeconds(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500 disabled:opacity-60"
            />
          </label>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => void saveRetryPolicy()}
            disabled={savingRetry}
            className="mt-3 px-3 py-1.5 text-xs font-semibold bg-surface-overlay text-fg-muted border border-border-strong rounded-lg hover:bg-surface-overlay disabled:opacity-50"
          >
            {savingRetry ? "Saving…" : "Save retry policy"}
          </button>
        )}
      </div>
    </div>
  );
}
