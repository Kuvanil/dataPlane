"use client";
import { useEffect, useState } from "react";
import { classNames, formatTimestamp } from "../lib/format";
import type { ExportArtifact } from "../lib/types";

interface ExportModalProps {
  open: boolean;
  artifact: ExportArtifact | null;
  loading: boolean;
  versionId: number | null;
  onClose: () => void;
}

export default function ExportModal({
  open,
  artifact,
  loading,
  onClose,
}: ExportModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  if (!open) return null;
  const json = artifact ? JSON.stringify(artifact, null, 2) : "";

  const download = () => {
    if (!artifact) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapping-${artifact.mapping_id}-v${artifact.version}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard may be unavailable
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export mapping"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Export Published Artifact
            </h2>
            {artifact && (
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {artifact.name} · v{artifact.version} ·{" "}
                {formatTimestamp(artifact.published_at)} by {artifact.published_by}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading || !artifact ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
            Loading artifact…
          </div>
        ) : (
          <>
            <div className="px-5 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 flex flex-wrap items-center gap-3">
              <span>
                <span className="text-zinc-600">Source:</span>{" "}
                {artifact.source.name ?? "—"} ({artifact.source.type})
              </span>
              <span>
                <span className="text-zinc-600">Target:</span>{" "}
                {artifact.target.name ?? "—"} ({artifact.target.type})
              </span>
              <span>
                <span className="text-zinc-600">Fields:</span>{" "}
                {artifact.field_mappings.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre
                className="text-[11px] font-mono text-zinc-200 bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 whitespace-pre overflow-x-auto"
                aria-label="Mapping JSON"
              >
                {json}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={copy}
                className={classNames(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg",
                  copied
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700",
                )}
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={download}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90"
              >
                ⬇ Download JSON
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
