"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connector } from "../lib/types";

interface EditConnectorModalProps {
  connector: Connector;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditConnectorModal({ connector, onClose, onSaved }: EditConnectorModalProps) {
  const [name, setName] = useState(connector.name);
  const [configJson, setConfigJson] = useState(JSON.stringify(connector.config, null, 2));
  const [rotateSecret, setRotateSecret] = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configJson);
    } catch {
      setError("Invalid JSON in config field.");
      return;
    }

    setSaving(true);
    try {
      await api.put(`/api/v1/connectors/${connector.id}`, {
        name,
        config: parsedConfig,
        ...(rotateSecret && newSecret ? { new_secret: newSecret } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update connector.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-200">Edit Connector</h3>
          <span className="text-xs text-zinc-500 font-mono bg-zinc-800 px-2 py-1 rounded-md">
            {connector.type}
          </span>
        </div>

        {error && (
          <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Connector Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="My_Database"
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:border-blue-500 text-zinc-200"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Type</label>
            <input
              value={connector.type}
              disabled
              className="px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 text-sm text-zinc-500 cursor-not-allowed"
            />
            <span className="text-[10px] text-zinc-600 mt-0.5">Type cannot be changed after creation.</span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Config JSON</label>
            <textarea
              value={configJson}
              onChange={e => setConfigJson(e.target.value)}
              required
              rows={4}
              className="px-3 py-2 font-mono text-xs rounded-lg bg-zinc-800 border border-zinc-700 focus:outline-none focus:border-blue-500 text-zinc-300"
            />
          </div>

          <div className="border-t border-zinc-800 pt-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={rotateSecret}
                onChange={e => setRotateSecret(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800"
              />
              Rotate credentials
            </label>
            {rotateSecret && (
              <div className="mt-2 flex flex-col gap-1">
                <label className="text-xs text-zinc-400">New credentials (JSON)</label>
                <textarea
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  rows={2}
                  placeholder='{"password": "new_secret_value"}'
                  className="px-3 py-2 font-mono text-xs rounded-lg bg-zinc-800 border border-zinc-700 focus:outline-none focus:border-blue-500 text-zinc-300"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold text-zinc-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}