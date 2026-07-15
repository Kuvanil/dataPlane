"use client";
import { classNames, formatRelativeTime } from "../lib/format";

interface DraftBarProps {
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
}

export default function DraftBar({ dirty, saving, lastSavedAt, error }: DraftBarProps) {
  let label: string;
  let tone: string;
  if (error) {
    label = `Autosave error: ${error}`;
    tone = "bg-red-500/10 text-red-300 border-red-500/20";
  } else if (saving) {
    label = "Saving…";
    tone = "bg-blue-500/10 text-blue-300 border-blue-500/20";
  } else if (dirty) {
    label = "Unsaved changes";
    tone = "bg-amber-500/10 text-amber-300 border-amber-500/20";
  } else if (lastSavedAt) {
    label = `Saved ${formatRelativeTime(lastSavedAt)}`;
    tone = "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  } else {
    label = "No edits yet";
    tone = "bg-surface-overlay text-fg0 border-border-strong";
  }
  return (
    <div
      className="px-5 py-1.5 border-b border-border bg-surface-elevated flex items-center justify-between text-[11px]"
      role="status"
      aria-live="polite"
    >
      <span className={classNames("px-2 py-0.5 rounded border font-medium", tone)}>
        {label}
      </span>
      <span className="text-fg0">
        Autosave every 30s · also saves on tab hide
      </span>
    </div>
  );
}
