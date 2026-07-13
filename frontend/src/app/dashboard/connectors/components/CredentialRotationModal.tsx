"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connector, TestResponse } from "../lib/types";

interface CredentialRotationModalProps {
  connector: Connector;
  onClose: () => void;
  onRotated: () => void;
}

export default function CredentialRotationModal({ connector, onClose, onRotated }: CredentialRotationModalProps) {
  const [newSecret, setNewSecret] = useState("");
  const [testResult, setTestResult] = useState<{ status: string; detail?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      let parsedSecret: Record<string, unknown>;
      try {
        parsedSecret = JSON.parse(newSecret);
      } catch {
        setError("Invalid JSON in credentials field.");
        setTesting(false);
        return;
      }
      const result = await api.post<TestResponse>(`/api/v1/connectors/${connector.id}/test`, {
        config: { ...connector.config, ...parsedSecret },
      });
      setTestResult({
        status: result.status,
        detail: result.status === "connected"
          ? [result.diagnostics?.version, result.diagnostics?.latency_ms != null ? `${result.diagnostics.latency_ms} ms` : null].filter(Boolean).join(" · ")
          : result.error?.message,
      });
    } catch (err) {
      setTestResult({ status: "failed", detail: err instanceof ApiError ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let parsedSecret: Record<string, unknown>;
      try {
        parsedSecret = JSON.parse(newSecret);
      } catch {
        setError("Invalid JSON in credentials field.");
        setSaving(false);
        return;
      }
      await api.post(`/api/v1/connectors/${connector.id}/rotate`, { new_secret: parsedSecret });
      onRotated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rotate credentials.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col gap-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-zinc-200">Rotate Credentials</h3>
        <p className="text-xs text-zinc-500">
          Update credentials for <span className="font-semibold text-zinc-300">{connector.name}</span>.
          Existing credentials will be replaced. New values are never displayed after saving.
        </p>

        {error && (
          <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">New credentials (JSON)</label>
          <textarea
            value={newSecret}
            onChange={e => setNewSecret(e.target.value)}
            rows={4}
            placeholder='{"password": "new_secret_value", "api_key": "new_key"}'
            className="px-3 py-2 font-mono text-xs rounded-lg bg-zinc-800 border border-zinc-700 focus:outline-none focus:border-blue-500 text-zinc-300"
          />
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-xs ${
            testResult.status === "connected"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/10 text-rose-400"
          }`}>
            <span className="font-semibold">{testResult.status === "connected" ? "✓ Connected" : "✗ Failed"}</span>
            {testResult.detail && <span className="ml-2 opacity-80">{testResult.detail}</span>}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing || !newSecret.trim()}
            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold text-zinc-300 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test New Credentials"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !newSecret.trim()}
            className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save New Credentials"}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}