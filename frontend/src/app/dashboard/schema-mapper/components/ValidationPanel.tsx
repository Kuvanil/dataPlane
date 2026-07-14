"use client";
import { useRouter } from "next/navigation";
import { classNames } from "../lib/format";
import type { ValidationResponse, FieldMapping, AISuggestion } from "../lib/types";
import { writeWorkspaceHandoff } from "../../query-workspace/lib/handoff";

interface ValidationPanelProps {
  validation: ValidationResponse | null;
  onClose: () => void;
  onJumpToEdge: (edgeId: number) => void;
  /** Edges array from the current mapping — needed to resolve table/column from edge_id. */
  edges?: FieldMapping[];
  /** All suggestions (pending + decided) — needed to resolve table/column from suggestion_id. */
  suggestions?: AISuggestion[];
  /** Source connection ID for building the handoff. */
  sourceConnectionId?: number | null;
}

export default function ValidationPanel({
  validation,
  onClose,
  onJumpToEdge,
  edges,
  suggestions,
  sourceConnectionId,
}: ValidationPanelProps) {
  const router = useRouter();
  if (!validation) return null;
  const { blocking_count, warning_count, ok_count, issues } = validation;
  return (
    <section
      aria-label="Validation results"
      className="border-t border-zinc-800 bg-zinc-900/40"
    >
      <div className="px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">Validation</h3>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/10 text-red-300 border border-red-500/20">
            {blocking_count} blocking
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20">
            {warning_count} warning{warning_count === 1 ? "" : "s"}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            {ok_count} ok
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          aria-label="Close validation panel"
        >
          ✕
        </button>
      </div>
      <div className="px-5 pb-3 max-h-48 overflow-y-auto">
        {issues.length === 0 ? (
          <div className="text-xs text-zinc-500 italic py-2">
            No issues reported.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {issues.map((iss, i) => (
              <li
                key={i}
                className={classNames(
                  "flex items-start gap-2 px-3 py-1.5 rounded text-[11px] border",
                  iss.verdict === "blocking"
                    ? "bg-red-500/5 border-red-500/20 text-red-300"
                    : iss.verdict === "lossy_warning"
                      ? "bg-amber-500/5 border-amber-500/20 text-amber-300"
                      : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300",
                )}
              >
                <span className="uppercase font-semibold text-[9px] mt-0.5 shrink-0">
                  {iss.verdict}
                </span>
                <span className="flex-1">{iss.message}</span>
                {iss.edge_id && (
                  <>
                    <button
                      type="button"
                      onClick={() => onJumpToEdge(iss.edge_id!)}
                      className="text-[10px] text-blue-300 hover:underline shrink-0"
                      aria-label="Jump to edge"
                    >
                      edge #{iss.edge_id} →
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (sourceConnectionId == null) return;
                        // Try to resolve the edge to get source table/column
                        const edge = edges?.find((e) => e.id === iss.edge_id);
                        if (edge && edge.sources.length > 0) {
                          const src = edge.sources[0];
                          writeWorkspaceHandoff({
                            connectionId: sourceConnectionId,
                            mode: "sql",
                            sql: `SELECT ${src.column} FROM ${src.table} WHERE ${src.column} IS NOT NULL LIMIT 100;`,
                            banner: { sourceModule: "schema_mapper", summary: `Validation issue on edge #${iss.edge_id} — ${iss.message}` },
                          });
                          router.push("/dashboard/query-workspace");
                        }
                      }}
                      className="text-[10px] text-emerald-400 hover:underline shrink-0"
                      aria-label="Investigate edge"
                    >
                      Investigate →
                    </button>
                  </>
                )}
                {!iss.edge_id && iss.suggestion_id && (() => {
                  const suggestion = suggestions?.find((s) => s.id === iss.suggestion_id);
                  // Without a resolved suggestion there's no real table/column to query —
                  // don't render a button that would send a fabricated query (no placeholder UI).
                  if (!suggestion) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (sourceConnectionId == null) return;
                        writeWorkspaceHandoff({
                          connectionId: sourceConnectionId,
                          mode: "sql",
                          sql: `SELECT ${suggestion.source_column}, COUNT(*) FROM ${suggestion.source_table} GROUP BY ${suggestion.source_column} ORDER BY COUNT(*) DESC LIMIT 50;`,
                          banner: { sourceModule: "schema_mapper", summary: `Validation issue (suggestion #${iss.suggestion_id}) — ${iss.message}` },
                        });
                        router.push("/dashboard/query-workspace");
                      }}
                      className="text-[10px] text-emerald-400 hover:underline shrink-0"
                      aria-label="Investigate suggestion issue"
                    >
                      Investigate →
                    </button>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
