"use client";

import { useState } from "react";

export default function AutopilotPage() {
  const [logs] = useState([
    "🤖 [15:12:01] Autopilot initialized with Model: local-slm-8b",
    "🔍 [15:12:04] Scanning target indices on `Analytical_Warehouse`...",
    "💡 [15:12:06] Proposing 14 column matches (Avg confidence 94%)",
    "🚧 [15:12:08] Detected column gap: `target.cost_center` not found in source.",
    "✅ [15:12:10] Created schema diff graph. Awaiting user approval.",
  ]);

  return (
    <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Console log area */}
      <div className="lg:col-span-2 flex flex-col gap-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-6 backdrop-blur-sm">
        <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <h3 className="font-semibold text-zinc-200">AI Execution Console</h3>
          <span className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 animate-pulse">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
            Listening
          </span>
        </div>
        <div className="flex-1 font-mono text-xs text-zinc-400 bg-zinc-950 p-4 rounded-xl border border-zinc-800 overflow-y-auto max-h-[400px] flex flex-col gap-2">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </div>

      {/* Control Panel */}
      <div className="flex flex-col gap-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-6 backdrop-blur-sm justify-between">
        <div>
          <h3 className="font-semibold text-zinc-200 mb-2">Autopilot Panel</h3>
          <p className="text-xs text-zinc-400 leading-relaxed mb-4">
            AI handles schema diffs and suggests casting rules on simulation runs.
          </p>
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-800 flex flex-col">
              <span className="text-xs text-zinc-500">Selected Model</span>
              <span className="text-sm font-semibold text-zinc-300">Llama3-8b (ollama)</span>
            </div>
            <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-800 flex flex-col">
              <span className="text-xs text-zinc-500">Mode</span>
              <span className="text-sm font-semibold text-zinc-300">Suggest Only</span>
            </div>
            <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-800 flex flex-col">
              <span className="text-xs text-zinc-500">Target Action</span>
              <span className="text-sm font-semibold text-zinc-300">MySQL ➝ Snowflake [Sim]</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold text-white transition-all">
            Simulate Pipeline
          </button>
          <button className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold text-zinc-400 transition-all border border-transparent hover:border-zinc-600">
            Edit Plan
          </button>
        </div>
      </div>
    </div>
  );
}
