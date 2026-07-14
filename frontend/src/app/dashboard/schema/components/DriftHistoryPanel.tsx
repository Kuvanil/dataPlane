"use client";
import { useRouter } from "next/navigation";
import { classNames, formatTimestamp } from "../lib/format";
import type { DriftHistoryResponse } from "../lib/types";
import { writeWorkspaceHandoff } from "../../query-workspace/lib/handoff";

interface DriftHistoryPanelProps {
  history: DriftHistoryResponse | null;
  onRescan: () => void;
  role: string | null;
  /** The current connection ID, needed for building the handoff. */
  connectionId?: number | null;
}

export default function DriftHistoryPanel({ history, onRescan, role, connectionId }: DriftHistoryPanelProps) {
  const router = useRouter();
  const canRescan = role === "admin" || role === "analyst";

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-zinc-200">Drift history</h4>
        {canRescan && (
          <button
            type="button"
            onClick={onRescan}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-800/60"
          >
            Re-scan for drift
          </button>
        )}
      </div>

      {!history || history.snapshots.length === 0 ? (
        <p className="text-xs text-zinc-500">No schema snapshots yet — drift detection runs periodically, or trigger a re-scan.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.snapshots.map((s) => (
            <li
              key={s.id}
              className={classNames(
                "text-xs rounded-lg px-3 py-2 border",
                s.drift_event
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-200"
                  : "bg-zinc-800/40 border-zinc-800 text-zinc-400",
              )}
            >
              <div className="flex items-center justify-between">
                <span>{formatTimestamp(s.captured_at)} · {s.table_count} tables</span>
                {s.drift_event && <span className="text-[10px] font-bold uppercase">drift detected</span>}
              </div>
              {s.drift_event && (
                <div className="mt-1 text-[11px] space-y-0.5">
                  {s.drift_event.tables_added.length > 0 && (
                    <div>+ tables: {s.drift_event.tables_added.join(", ")}</div>
                  )}
                  {s.drift_event.tables_removed.length > 0 && (
                    <div>− tables: {s.drift_event.tables_removed.join(", ")}</div>
                  )}
                  {Object.keys(s.drift_event.columns_added).length > 0 && (
                    <div>+ columns: {Object.entries(s.drift_event.columns_added).map(([t, cols]) => `${t}.${cols.join(",")}`).join("; ")}</div>
                  )}
                  {Object.keys(s.drift_event.columns_removed).length > 0 && (
                    <div>− columns: {Object.entries(s.drift_event.columns_removed).map(([t, cols]) => `${t}.${cols.join(",")}`).join("; ")}</div>
                  )}
                  {Object.keys(s.drift_event.type_changes).length > 0 && (
                    <div>type changes: {Object.entries(s.drift_event.type_changes).map(([t, cols]) => `${t}.${cols.join(",")}`).join("; ")}</div>
                  )}
                  {/* Investigate actions for each affected table (non-removed) */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[
                      ...new Set([
                        ...Object.keys(s.drift_event.columns_added),
                        ...Object.keys(s.drift_event.columns_removed),
                        ...Object.keys(s.drift_event.type_changes),
                      ]),
                    ].map((tableName) => (
                      <button
                        key={tableName}
                        type="button"
                        onClick={() => {
                          if (connectionId == null) return;
                          writeWorkspaceHandoff({
                            connectionId,
                            mode: "sql",
                            sql: `SELECT * FROM ${tableName} LIMIT 100;`,
                            banner: { sourceModule: "schema_intel", summary: `Drift on ${tableName} — see changed columns below` },
                          });
                          router.push("/dashboard/query-workspace");
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20"
                      >
                        Investigate {tableName} →
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
