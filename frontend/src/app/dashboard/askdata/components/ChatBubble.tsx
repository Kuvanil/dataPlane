"use client";
import { useState } from "react";
import { ChatTurn } from "../lib/types";

export default function ChatBubble({ turn, connectionId, onEditInSql }: { turn: ChatTurn; connectionId: number | null; onEditInSql: (connectionId: number, sql: string) => void }) {
  const [showSql, setShowSql] = useState(false);
  const isUser = turn.role === "user";
  const res = turn.response;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600/20 border border-blue-500/20 text-zinc-200"
            : "bg-zinc-900/60 border border-zinc-800 text-zinc-300"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-[10px]">🤖</span>
            <span className="text-[10px] font-semibold text-zinc-400">AskData</span>
            <span className="text-[9px] text-zinc-600 ml-auto">{turn.timestamp}</span>
          </div>
        )}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{turn.content}</div>

        {res?.sql && (
          <div className="mt-2">
            <button
              onClick={() => setShowSql((s) => !s)}
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              {showSql ? "Hide SQL" : "Show SQL"}
            </button>
            {showSql && (
              <pre className="mt-1 text-[11px] font-mono text-blue-300 bg-zinc-950/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                {res.sql}
              </pre>
            )}
          </div>
        )}

        {res?.executed && res.rows.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-zinc-900/50">
                  {res.columns.map((c) => (
                    <th key={c} className="p-1.5 text-left font-semibold text-zinc-400 border-b border-zinc-800">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    {res.columns.map((c) => (
                      <td key={c} className="p-1.5 text-zinc-300 font-mono border-b border-zinc-800/40">{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {res.row_count > 20 && (
              <div className="p-1.5 text-center text-[10px] text-zinc-500">Showing 20 of {res.row_count} rows</div>
            )}
          </div>
        )}

        {res?.masked_columns && res.masked_columns.length > 0 && (
          <div className="mt-1 text-[10px] text-amber-400">
            🔒 Masked: {res.masked_columns.join(", ")}
          </div>
        )}
        {res && !res.grounded && res.executed && (
          <div className="mt-1 text-[10px] text-zinc-500">
            ⚠️ Not grounded in the Schema Intel catalog — scan this connection for better accuracy.
          </div>
        )}

        {res?.sql && connectionId != null && (
          <div className="mt-2">
            <button
              onClick={() => onEditInSql(connectionId, res.sql as string)}
              className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Edit in Query Studio →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
