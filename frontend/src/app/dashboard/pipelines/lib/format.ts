/**
 * Small formatting helpers for the Pipeline Management UI.
 */

export function classNames(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "—";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

const CRON_PRESETS: Record<string, string> = {
  "* * * * *": "every minute",
  "*/5 * * * *": "every 5 minutes",
  "*/15 * * * *": "every 15 minutes",
  "*/30 * * * *": "every 30 minutes",
  "0 * * * *": "every hour",
  "0 0 * * *": "every day at midnight",
  "0 2 * * *": "every day at 2:00 AM",
  "0 0 * * 0": "every Sunday at midnight",
  "0 0 1 * *": "on the 1st of every month",
};

/** Best-effort human-readable preview of a 5-field cron expression. Falls
 * back to the raw expression for anything not in the common-case table —
 * a full cron-to-English translator is out of scope for this preview. */
export function describeCron(expr: string): string {
  const trimmed = expr.trim();
  if (CRON_PRESETS[trimmed]) return CRON_PRESETS[trimmed];
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [min, hour, dom, , dow] = parts;
  if (dom === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `every day at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return trimmed;
}

export function statusColor(status: string): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "failed":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "running":
      return "bg-blue-500/15 text-blue-300 border-blue-500/30";
    case "retrying":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:
      return "bg-surface-overlay text-fg-subtle border-border-strong";
  }
}
