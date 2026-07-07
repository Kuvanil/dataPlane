"use client";
import Link from "next/link";
import { DashboardWidget } from "./DashboardWidget";
import type { FeedItemData } from "../types";

const EVENT_TYPE_META: Record<string, { icon: string; label: string }> = {
  connector_created: { icon: "➕", label: "Connector added" },
  connector_deleted: { icon: "🗑️", label: "Connector removed" },
  connector_tested: { icon: "✅", label: "Connection tested" },
  mapping_created: { icon: "🔗", label: "Mapping created" },
  mapping_published: { icon: "📢", label: "Mapping published" },
  pipeline_created: { icon: "📦", label: "Pipeline created" },
  pipeline_run_started: { icon: "▶️", label: "Pipeline run started" },
  pipeline_run_succeeded: { icon: "✅", label: "Pipeline run succeeded" },
  pipeline_run_failed: { icon: "❌", label: "Pipeline run failed" },
  pipeline_run_retrying: { icon: "🔄", label: "Pipeline run retrying" },
  schema_scanned: { icon: "📡", label: "Schema scanned" },
  schema_drift_detected: { icon: "⚠️", label: "Drift detected" },
  schema_classified: { icon: "🏷️", label: "Schema classified" },
  security_alert: { icon: "🚨", label: "Security alert" },
  autopilot_action: { icon: "🤖", label: "AI Autopilot action" },
  query_executed: { icon: "💡", label: "Query executed" },
};

function eventMeta(eventType: string) {
  return EVENT_TYPE_META[eventType] ?? { icon: "📄", label: eventType };
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const MAX_VISIBLE_ITEMS = 8;

interface ActivityFeedProps {
  items: FeedItemData[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * ActivityFeed — enriched cross-module activity from the aggregation API
 * (dashboard_tasks #5). Items with a link_url drill through to their
 * owning module; failures are tinted; long feeds truncate to 8 with a
 * "view all" link into the audit trail.
 */
export function ActivityFeed({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  className,
}: ActivityFeedProps) {
  const visible = items.slice(0, MAX_VISIBLE_ITEMS);
  const hasMore = items.length > MAX_VISIBLE_ITEMS;

  return (
    <DashboardWidget
      title="Recent Activity"
      icon="📋"
      isLoading={isLoading}
      isError={isError}
      errorMessage={errorMessage}
      onRetry={onRetry}
      isEmpty={items.length === 0}
      emptyMessage="No activity yet — connect a source or create a mapping to get started."
      className={className}
    >
      <ul className="flex flex-col gap-2">
        {visible.map((item) => {
          const meta = eventMeta(item.event_type);
          const isFailure = item.status === "failure";
          const row = (
            <>
              <span
                className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm ${
                  isFailure ? "bg-red-500/10" : "bg-zinc-800/80"
                }`}
                role="img"
                aria-hidden="true"
              >
                {meta.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">
                  {item.summary || meta.label}
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {item.actor} · {formatRelativeTime(item.created_at)}
                </p>
              </div>
              {isFailure && (
                <span className="text-[10px] font-semibold text-red-400 shrink-0">Failed</span>
              )}
            </>
          );
          const rowClass = `flex items-center gap-3 p-3 rounded-xl border transition-colors ${
            isFailure
              ? "bg-red-500/5 border-red-500/10"
              : "bg-zinc-800/30 border-zinc-800/50"
          }`;
          return (
            <li key={item.id}>
              {item.link_url ? (
                <Link href={item.link_url} className={`${rowClass} hover:bg-zinc-800/60`}>
                  {row}
                </Link>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <Link
          href="/dashboard/audit"
          className="block text-center text-sm text-blue-400 hover:text-blue-300 pt-3"
        >
          View all activity →
        </Link>
      )}
    </DashboardWidget>
  );
}
