"use client";
import { AuditEvent } from "../lib/types";

/** Sequence-ordered trace of every event sharing a correlation_id. */
export default function CorrelationTimeline({
  events,
  isLoading,
  activeId,
  onJump,
}: {
  events: AuditEvent[];
  isLoading: boolean;
  activeId: number;
  onJump: (event: AuditEvent) => void;
}) {
  if (isLoading) {
    return <div className="text-xs text-zinc-500">Loading trace…</div>;
  }
  if (events.length <= 1) {
    return <div className="text-xs text-zinc-500">No other events share this correlation ID.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((ev, i) => (
        <div key={ev.id} className="flex items-start gap-3">
          <div className="flex flex-col items-center pt-1">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                ev.id === activeId ? "bg-blue-400" : "bg-zinc-600"
              }`}
            />
            {i < events.length - 1 && <div className="w-px flex-1 bg-zinc-800 mt-1" style={{ minHeight: 20 }} />}
          </div>
          <button
            onClick={() => onJump(ev)}
            className={`flex-1 text-left rounded-lg px-3 py-2 text-xs border transition-colors ${
              ev.id === activeId
                ? "border-blue-500/40 bg-blue-500/10"
                : "border-zinc-800 hover:bg-zinc-800/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-200 font-medium">{ev.event_type}</span>
              <span className="text-zinc-500 font-mono">{new Date(ev.created_at).toLocaleTimeString()}</span>
            </div>
            {ev.summary && <div className="text-zinc-500 mt-0.5">{ev.summary}</div>}
          </button>
        </div>
      ))}
    </div>
  );
}
