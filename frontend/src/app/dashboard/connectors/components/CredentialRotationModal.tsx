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
      <div className="w-full max-w-md p-6 rounded-2xl bg-surface border border-border flex flex-col gap-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-fg-muted">Rotate Credentials</h3>
        <p className="text-xs text-fg0">
          Update credentials for <span className="font-semibold text-fg-muted">{connector.name}</span>.
          Existing credentials will be replaced. New values are never displayed after saving.
        </p>

        {error && (
          <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-subtle">New credentials (JSON)</label>
          <textarea
            value={newSecret}
            onChange={e => setNewSecret(e.target.value)}
            rows={4}
            placeholder='{"password": "new_secret_value", "api_key": "new_key"}'
            className="px-3 py-2 font-mono text-xs rounded-lg bg-surface-overlay border border-border-strong focus:outline-none focus:border-blue-500 text-fg-muted"
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
            className="flex-1 py-2 bg-surface-overlay hover:bg-surface-overlay rounded-xl text-sm font-semibold text-fg-muted disabled:opacity-50"
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
          className="w-full py-2 text-xs text-fg0 hover:text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}