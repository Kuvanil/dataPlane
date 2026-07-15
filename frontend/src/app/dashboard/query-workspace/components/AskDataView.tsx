"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import ChatBubble from "../../askdata/components/ChatBubble";
import ConnectionPicker from "../../askdata/components/ConnectionPicker";
import SchemaDesignPlanCard from "./SchemaDesignPlanCard";
import type { AskDataAskResponse, ChatTurn } from "../../askdata/lib/types";
import type { Connection } from "../../query-studio/lib/types";

const SUGGESTIONS = [
  "show all tables",
  "count rows",
  "show everything in the first table",
  "database health",
];

interface AskDataViewProps {
  connections: Connection[];
  connectionId: number | null;
  setConnectionId: (id: number) => void;
  /** Optional pre-filled question (from a handoff) — NOT auto-sent. */
  prefillQuestion?: string;
  /** Callback to edit SQL in the SQL view */
  onEditInSql: (connectionId: number, sql: string) => void;
  /** Called when `loading` transitions from true to false (background completion). */
  onBackgroundComplete?: () => void;
}

export default function AskDataView({
  connections,
  connectionId,
  setConnectionId,
  prefillQuestion,
  onEditInSql,
  onBackgroundComplete,
}: AskDataViewProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([{
    role: "assistant",
    content: "Hi! I'm AskData — ask a question in plain English and I'll ground it in your schema, generate SQL, and run it read-only.",
    timestamp: new Date().toLocaleTimeString(),
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);

  // Apply prefillQuestion once on mount (or when it changes via handoff)
  useEffect(() => {
    if (prefillQuestion) {
      setInput(prefillQuestion);
    }
  }, [prefillQuestion]);

  // Track loading → false transitions for the background-completion badge
  // (mirrors SqlWorkspaceView's running → false tracking).
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      onBackgroundComplete?.();
    }
    prevLoadingRef.current = loading;
  }, [loading, onBackgroundComplete]);

  const sendMessage = async (text?: string) => {
    const question = text ?? input;
    if (!question.trim() || connectionId == null) return;
    setTurns((p) => [...p, { role: "user", content: question, timestamp: new Date().toLocaleTimeString() }]);
    setInput("");
    setLoading(true);
    try {
      const data = await api.post<AskDataAskResponse>("/api/v1/askdata/ask", {
        connection_id: connectionId,
        question,
        session_id: sessionId,
      });
      setSessionId(data.session_id);
      setTurns((p) => [...p, {
        role: "assistant",
        content: data.error ?? data.summary ?? "No response generated.",
        timestamp: new Date().toLocaleTimeString(),
        response: data,
      }]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "AskData is unreachable — is the API running?";
      setTurns((p) => [...p, { role: "assistant", content: message, timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-border bg-surface-elevated backdrop-blur-sm flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-fg-muted flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-sm">🤖</span>
            AskData
          </h3>
          <p className="text-xs text-fg0 ml-10">Ask in plain English — grounded, transparent SQL, read-only.</p>
        </div>
        <ConnectionPicker connections={connections} value={connectionId} onChange={setConnectionId} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {turns.map((turn, i) => (
          <div key={i}>
            <ChatBubble turn={turn} connectionId={connectionId} onEditInSql={onEditInSql} />
            {turn.response?.plan_id != null && (
              <div className="flex justify-start">
                <div className="max-w-[80%] w-full">
                  <SchemaDesignPlanCard planId={turn.response.plan_id} />
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-elevated border border-border rounded-2xl px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-xs text-fg0">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {turns.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s)}
              className="px-3 py-1.5 text-[11px] rounded-full bg-surface-overlay border border-border-strong/50 text-fg-subtle hover:bg-surface-overlay hover:text-fg-muted transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 border-t border-border bg-surface-elevated">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask about your data…"
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-overlay border border-border-strong text-sm focus:outline-none focus:border-blue-500 text-fg-muted placeholder:text-fg-subtle"
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim() || connectionId == null}
            className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-violet-500 to-blue-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}