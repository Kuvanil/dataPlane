"use client";
interface PublishDialogProps {
  open: boolean;
  blockingCount: number;
  warningCount: number;
  currentVersionId: number | null;
  onCancel: () => void;
  onConfirm: () => void;
  publishing: boolean;
}

export default function PublishDialog({
  open,
  blockingCount,
  warningCount,
  currentVersionId,
  onCancel,
  onConfirm,
  publishing,
}: PublishDialogProps) {
  if (!open) return null;
  const nextVersion = (currentVersionId ?? 0) + 1;
  const canPublish = blockingCount === 0;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish mapping"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !publishing) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface border border-border p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-fg mb-1">
          Publish new version
        </h2>
        <p className="text-xs text-fg0 mb-4">
          This creates an immutable version that the Pipelines module can consume.
        </p>
        <ul className="text-xs space-y-1 mb-4">
          <li className="flex justify-between">
            <span className="text-fg-subtle">Next version label</span>
            <span className="font-mono text-fg-muted">v{nextVersion}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-fg-subtle">Blocking issues</span>
            <span className={blockingCount === 0 ? "text-emerald-400" : "text-red-400"}>
              {blockingCount}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-fg-subtle">Warnings</span>
            <span className={warningCount === 0 ? "text-fg0" : "text-amber-400"}>
              {warningCount}
            </span>
          </li>
        </ul>
        {!canPublish && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-4">
            Resolve {blockingCount} blocking issue{blockingCount === 1 ? "" : "s"} before publishing.
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={publishing}
            className="px-4 py-2 text-sm text-fg-subtle hover:text-fg-muted rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canPublish || publishing}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? "Publishing…" : `Publish v${nextVersion}`}
          </button>
        </div>
      </div>
    </div>
  );
}
