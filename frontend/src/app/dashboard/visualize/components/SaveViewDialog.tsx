"use client";
import { useState } from "react";
import type { VizView } from "../lib/types";

interface SaveViewDialogProps {
  savedViews: VizView[];
  onSave: (name: string) => Promise<void>;
  onLoad: (view: VizView) => void;
  onDelete: (viewId: number) => void;
  canSave: boolean;
}

export default function SaveViewDialog({ savedViews, onSave, onLoad, onDelete, canSave }: SaveViewDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim());
      setName("");
    } catch {
      // toast already shown by hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 text-xs font-semibold text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-800/60"
      >
        Views {savedViews.length > 0 ? `(${savedViews.length})` : ""}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl z-40 p-3">
          {canSave && (
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Save current view as…"
                className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200"
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !name.trim()}
                className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          )}
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {savedViews.length === 0 ? (
              <p className="text-[11px] text-zinc-500 text-center py-3">No saved views yet.</p>
            ) : (
              savedViews.map((v) => (
                <div key={v.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-800/50 text-xs">
                  <button type="button" onClick={() => { onLoad(v); setOpen(false); }} className="flex-1 text-left text-zinc-300">
                    {v.name} <span className="text-zinc-600">· {v.chart_type}</span>
                  </button>
                  {canSave && (
                    <button type="button" onClick={() => onDelete(v.id)} aria-label="Delete view" className="text-zinc-500 hover:text-red-400 px-1">
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
