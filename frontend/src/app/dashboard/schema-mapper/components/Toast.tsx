"use client";
import { classNames } from "../lib/format";

interface ToastProps {
  toast: { kind: "info" | "error" | "success"; message: string } | null;
  onDismiss: () => void;
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;
  const tone =
    toast.kind === "error"
      ? "bg-red-500/10 border-red-500/30 text-red-300"
      : toast.kind === "success"
        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
        : "bg-blue-500/10 border-blue-500/30 text-blue-300";
  const icon =
    toast.kind === "error" ? "⚠️" : toast.kind === "success" ? "✅" : "ℹ️";
  return (
    <div
      role="status"
      aria-live="polite"
      className={classNames(
        "fixed top-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur",
        tone,
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden>{icon}</span>
        <span className="flex-1">{toast.message}</span>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="ml-2 text-xs opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
