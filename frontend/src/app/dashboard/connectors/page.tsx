"use client";
import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connector, TestResponse, SchemaData } from "./lib/types";
import { CONFIG_TEMPLATES, TYPE_META, VALID_TYPES } from "./lib/types";
import ConnectorCard from "./components/ConnectorCard";

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("sqlite");
  const [configJson, setConfigJson] = useState(CONFIG_TEMPLATES.sqlite);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { status: string; detail?: string }>>({});

  const [schemaModal, setSchemaModal] = useState<SchemaData | null>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Connector[]>("/api/v1/connectors/");
      setConnectors(data);
    } catch (err) {
      setConnectors([]);
      setError(err instanceof ApiError ? err.message : "Failed to load connectors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configJson);
    } catch {
      setCreateError("Invalid JSON in config field.");
      return;
    }

    setCreating(true);
    try {
      await api.post("/api/v1/connectors/", { name, type, config: parsedConfig });
      setIsModalOpen(false);
      setName("");
      setConfigJson(CONFIG_TEMPLATES.sqlite);
      await fetchConnectors();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to create connector.");
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    setTestResults(prev => ({ ...prev, [id]: { status: "testing" } }));
    try {
      const result = await api.post<TestResponse>(`/api/v1/connectors/${id}/test`, {});
      const detail = result.status === "connected"
        ? [result.diagnostics?.version, result.diagnostics?.latency_ms != null ? `${result.diagnostics.latency_ms} ms` : null].filter(Boolean).join(" · ")
        : result.error?.message;
      setTestResults(prev => ({ ...prev, [id]: { status: result.status, detail: detail ?? undefined } }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [id]: { status: "failed", detail: err instanceof ApiError ? err.message : undefined },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleScanSchema = async (id: number) => {
    setScanningId(id);
    try {
      const data = await api.get<SchemaData>(`/api/v1/connectors/${id}/schema`);
      setSchemaModal(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Schema scan failed.");
    } finally {
      setScanningId(null);
    }
  };

  return (
    <div className="p-8 flex flex-col gap-6 relative h-full overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Your Connectors</h3>
          <p className="text-xs text-zinc-500">Manage sources and targets — Postgres, MySQL, Oracle, SQLite, JDBC</p>
        </div>
        <button
          onClick={() => { setIsModalOpen(true); setCreateError(null); }}
          className="px-4 py-2 text-sm font-semibold text-zinc-950 bg-white rounded-xl hover:bg-zinc-200 transition-all flex items-center gap-2"
        >
          ➕ New Connector
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300/70 hover:text-rose-200 text-xs">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading connectors...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connectors.map((c) => (
            <ConnectorCard
              key={c.id}
              connector={c}
              testResult={testResults[c.id]}
              isTesting={testingId === c.id}
              isScanning={scanningId === c.id}
              onTest={handleTest}
              onScan={handleScanSchema}
              onRefresh={fetchConnectors}
            />
          ))}
          <div
            onClick={() => { setIsModalOpen(true); setCreateError(null); }}
            className="border border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center p-6 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400 cursor-pointer transition-all min-h-[160px]"
          >
            <span className="text-3xl mb-1">🔌</span>
            <span className="text-sm">Link another Database</span>
          </div>
        </div>
      )}

      {/* Create modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="w-full max-w-md p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col gap-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-zinc-200">New Database Connector</h3>
            {createError && (
              <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{createError}</div>
            )}
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
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
                <select
                  value={type}
                  onChange={e => { setType(e.target.value); setConfigJson(CONFIG_TEMPLATES[e.target.value] ?? "{}"); }}
                  className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:border-blue-500 text-zinc-300"
                >
                  {VALID_TYPES.map(t => (
                    <option key={t} value={t}>{TYPE_META[t]?.icon} {t}</option>
                  ))}
                </select>
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
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Add Connector"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schema modal */}
      {schemaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">{schemaModal.name} — Schema</h3>
                <p className="text-xs text-zinc-500">{Object.keys(schemaModal.schema).length} tables</p>
              </div>
              <button onClick={() => setSchemaModal(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">✕ Close</button>
            </div>
            <div className="overflow-y-auto p-5 flex flex-col gap-4">
              {Object.entries(schemaModal.schema).map(([table, cols]) => (
                <div key={table} className="rounded-xl border border-zinc-800 overflow-hidden">
                  <div className="px-4 py-2 bg-zinc-800/40 text-xs font-semibold text-zinc-300 font-mono">
                    {table} <span className="text-zinc-500 font-normal">({cols.length} cols)</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="px-4 py-2 text-left text-zinc-500 font-medium">Column</th>
                        <th className="px-4 py-2 text-left text-zinc-500 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cols.map(col => (
                        <tr key={col.name} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                          <td className="px-4 py-1.5 font-mono text-zinc-300">{col.name}</td>
                          <td className="px-4 py-1.5 font-mono text-zinc-500">{col.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}