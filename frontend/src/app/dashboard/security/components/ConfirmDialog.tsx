"use client";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Generic confirmation modal for privileged/destructive Security Admin
 * actions (FR8/AC3) — role deletion, revoking a user's last role, etc. */
export default function ConfirmDialog({
  title, message, confirmLabel = "Confirm", danger = true, busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-2xl bg-surface border border-border flex flex-col gap-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-fg-muted">{title}</h3>
        <p className="text-sm text-fg-subtle whitespace-pre-line">{message}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 bg-surface-overlay hover:bg-surface-overlay rounded-xl text-sm font-semibold text-fg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
