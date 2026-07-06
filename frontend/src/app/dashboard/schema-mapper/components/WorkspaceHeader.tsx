"use client";
import { useEffect, useRef, useState } from "react";
import { classNames } from "../lib/format";
import type { Mapping, Role, ValidationResponse } from "../lib/types";

interface WorkspaceHeaderProps {
  mapping: Mapping;
  role: Role | null;
  validation: ValidationResponse | null;
  onValidate: () => void;
  onPublish: () => void;
  onExport: () => void;
  onRename: (name: string) => Promise<void>;
  validating: boolean;
  publishing: boolean;
}

export default function WorkspaceHeader({
  mapping,
  role,
  validation,
  onValidate,
  onPublish,
  onExport,
  onRename,
  validating,
  publishing,
}: WorkspaceHeaderProps) {
  const isDraft = mapping.status === "draft";
  const canEdit = isDraft && (role === "admin" || role === "analyst");
  const canPublish = canEdit && role === "admin";
  const blocking = validation?.blocking_count ?? 0;
  const warnings = validation?.warning_count ?? 0;

  // Inline-rename UI (TRD FR8 implied; mapper_tasks #6).
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(mapping.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft in sync if the mapping changes externally (e.g. switched
  // mappings in the sidebar list).
  useEffect(() => {
    if (!editing) setDraftName(mapping.name);
  }, [mapping.name, editing]);

  // Focus the input when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!canEdit) return;
    setDraftName(mapping.name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraftName(mapping.name);
    setEditing(false);
  };

  const commitEdit = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === mapping.name) {
      cancelEdit();
      return;
    }
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch {
      // onRename already toasted the error; leave the editor open so the
      // user can fix and retry.
    }
  };

  return (
    <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              aria-label="Rename mapping"
              className="text-base font-semibold text-zinc-100 bg-zinc-800 border border-blue-500/40 rounded px-2 py-0.5 min-w-0 max-w-md focus:outline-none focus:border-blue-500"
            />
          ) : (
            <h2 className="text-base font-semibold text-zinc-100 truncate flex items-center gap-2">
              <span>{mapping.name}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Rename mapping"
                  title="Rename mapping"
                  className="text-zinc-500 hover:text-zinc-200 transition-colors text-xs"
                >
                  ✎
                </button>
              )}
            </h2>
          )}
          <span
            className={classNames(
              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
              isDraft
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
            )}
          >
            {mapping.status}
            {mapping.current_version_id && isDraft === false
              ? ` v${mapping.current_version_id}`
              : ""}
          </span>
          {blocking > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20">
              {blocking} blocking
            </span>
          )}
          {warnings > 0 && blocking === 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          #{mapping.id} · {mapping.edges.length} edge
          {mapping.edges.length === 1 ? "" : "s"} · created by {mapping.created_by}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onValidate}
          disabled={validating}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          aria-label="Validate mapping"
        >
          {validating ? "Validating…" : "✓ Validate"}
        </button>
        <button
          type="button"
          onClick={onExport}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          aria-label="Export published mapping"
        >
          ⬇ Export
        </button>
        {canPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing || blocking > 0}
            title={
              blocking > 0
                ? `Resolve ${blocking} blocking issue(s) before publishing`
                : isDraft
                  ? "Publish a new immutable version"
                  : "Already published"
            }
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Publish mapping"
          >
            {publishing ? "Publishing…" : "🚀 Publish"}
          </button>
        )}
        {!canEdit && role !== null && (
          <span
            className="text-[11px] text-zinc-500 italic"
            title="Your role cannot edit this mapping."
          >
            Read-only ({role})
          </span>
        )}
      </div>
    </div>
  );
}
