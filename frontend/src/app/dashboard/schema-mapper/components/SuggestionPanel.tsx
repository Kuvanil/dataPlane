"use client";
import { classNames, formatPercent, truncate } from "../lib/format";
import type { AISuggestion, Role } from "../lib/types";

interface SuggestionPanelProps {
  pending: AISuggestion[];
  decided: AISuggestion[];
  loading: boolean;
  role: Role | null;
  onRequest: () => void;
  onAccept: (id: number) => void;
  onReject: (id: number) => void;
}

export default function SuggestionPanel({
  pending,
  decided,
  loading,
  role,
  onRequest,
  onAccept,
  onReject,
}: SuggestionPanelProps) {
  const canEdit = role === "admin" || role === "analyst";
  return (
    <section
      aria-label="AI suggestions"
      className="border-t border-zinc-800 bg-zinc-900/30"
    >
      <div className="px-5 py-2.5 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">AI Suggestions</h3>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
            {pending.length} pending · {decided.length} decided
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onRequest}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:opacity-90 disabled:opacity-50"
            aria-label="Request AI suggestions"
          >
            {loading ? "Generating…" : "🧠 Get AI Suggestions"}
          </button>
        )}
      </div>
      <div className="px-5 pb-3 max-h-72 overflow-y-auto">
        {pending.length === 0 && decided.length === 0 ? (
          <div className="text-xs text-zinc-500 italic py-2">
            No suggestions yet. Click <span className="text-zinc-300">Get AI Suggestions</span> to generate candidates for unmapped target columns.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pending.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-violet-500/20 bg-violet-500/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-blue-300 truncate">
                      {truncate(`${s.source_table}.${s.source_column}`, 30)}
                    </span>
                    <span className="text-zinc-500">→</span>
                    <span className="font-mono text-indigo-300 truncate">
                      {truncate(`${s.target_table}.${s.target_column}`, 30)}
                    </span>
                  </div>
                  {s.reason && (
                    <p className="text-[10px] text-zinc-500 mt-1 truncate">
                      {s.reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/20">
                    {formatPercent(s.confidence)}
                  </span>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => onAccept(s.id)}
                        className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                        aria-label="Accept suggestion"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(s.id)}
                        className="px-2 py-1 text-[11px] font-semibold rounded bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                        aria-label="Reject suggestion"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {decided.length > 0 && (
              <li className="mt-2 mb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Decided
              </li>
            )}
            {decided.slice(0, 8).map((s) => (
              <li
                key={s.id}
                className={classNames(
                  "flex items-center justify-between gap-2 px-3 py-1.5 rounded text-[11px]",
                  s.status === "accepted"
                    ? "bg-emerald-500/5 text-emerald-300/80"
                    : "bg-zinc-900/40 text-zinc-500",
                )}
              >
                <span className="font-mono truncate">
                  {truncate(`${s.source_table}.${s.source_column}`, 28)} → {truncate(`${s.target_table}.${s.target_column}`, 28)}
                </span>
                <span className="text-[10px] uppercase font-semibold shrink-0">
                  {s.status} · {formatPercent(s.confidence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
