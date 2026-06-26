"use client";

import { useState, useRef, useEffect } from "react";

interface QueryResult {
  query: string;
  sql: string;
  method: string;
  confidence: number;
  results: any;
  row_count?: number;
  error?: string;
  report_type?: string;
  connection?: string;
}

const TEMPLATES = [
  { label: "📊 Database Health Report", query: "Show me the database health report" },
  { label: "🛡️ PII Exposure Scan", query: "Find all PII and sensitive columns" },
  { label: "📋 Show All Tables", query: "Show all tables in the database" },
  { label: "🔢 Count Rows", query: "Count rows in all tables" },
  { label: "🏗️ Table Structure", query: "Show the structure of crm_users table" },
  { label: "📈 Select All Data", query: "Show everything in crm_leads" },
];

export default function QueryStudioPage() {
  const [query, setQuery] = useState("");
  const [connectionId, setConnectionId] = useState(1);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/connectors/")
      .then(r => r.ok ? r.json() : [])
      .then(data => setConnections(data))
      .catch(() => {
        setConnections([
          { id: 1, name: "CRM_Source_Analytics", type: "sqlite" },
          { id: 2, name: "Data_Warehouse_Target", type: "sqlite" },
          { id: 3, name: "ECommerce_MySQL", type: "sqlite" },
          { id: 4, name: "Finance_Oracle", type: "oracle" },
          { id: 5, name: "HR_Postgres", type: "postgres" },
        ]);
      });
  }, []);

  const executeQuery = async (q?: string) => {
    const queryText = q || query;
    if (!queryText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/v1/query/nl2sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText, connection_id: connectionId, execute: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(prev => [data, ...prev]);
      }
    } catch (err) {
      // Offline demo fallback
      setResults(prev => [{
        query: queryText, sql: "-- Demo mode: API not connected", method: "demo",
        confidence: 0, results: [], error: "Backend API is not reachable. Start docker-compose to see live results.",
      }, ...prev]);
    } finally {
      setLoading(false);
      setQuery("");
      inputRef.current?.focus();
    }
  };

  const renderResults = (res: QueryResult) => {
    if (res.error) {
      return <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400 text-xs">{res.error}</div>;
    }
    if (res.report_type === "pii_scan" && Array.isArray(res.results)) {
      return (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold text-amber-400 mb-1">🛡️ PII Scan Results ({res.results.length} findings)</div>
          {res.results.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 text-xs p-2 rounded-lg bg-zinc-800/30">
              <span className="font-mono text-red-400">{r.table}.{r.column}</span>
              <span className="text-zinc-500">matched: <span className="text-amber-400">{r.pii_keyword}</span></span>
            </div>
          ))}
        </div>
      );
    }
    if (res.report_type === "health" && typeof res.results === "object" && !Array.isArray(res.results)) {
      const h = res.results;
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Tables", value: h.total_tables, color: "text-blue-400" },
            { label: "Columns", value: h.total_columns, color: "text-indigo-400" },
            { label: "Nullable", value: h.nullable_columns, color: "text-amber-400" },
            { label: "PKs", value: h.primary_keys, color: "text-emerald-400" },
            { label: "Health Score", value: `${h.health_score}%`, color: h.health_score >= 75 ? "text-emerald-400" : "text-red-400" },
          ].map((m, i) => (
            <div key={i} className="p-3 rounded-lg bg-zinc-800/30 border border-zinc-800/50">
              <div className={`text-lg font-bold ${m.color}`}>{m.value ?? 0}</div>
              <div className="text-[10px] text-zinc-500">{m.label}</div>
            </div>
          ))}
          {h.tables_without_pk?.length > 0 && (
            <div className="col-span-full text-xs text-amber-400">
              ⚠️ Tables without PK: {h.tables_without_pk.join(", ")}
            </div>
          )}
        </div>
      );
    }
    // Table results
    if (Array.isArray(res.results) && res.results.length > 0) {
      const keys = Object.keys(res.results[0]);
      return (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-900/50">
                {keys.map(k => <th key={k} className="p-2 text-left font-semibold text-zinc-400 border-b border-zinc-800">{k}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.results.slice(0, 50).map((row: any, i: number) => (
                <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                  {keys.map(k => <td key={k} className="p-2 text-zinc-300 font-mono border-b border-zinc-800/40">{String(row[k] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {res.results.length > 50 && (
            <div className="p-2 text-center text-[10px] text-zinc-500">Showing 50 of {res.results.length} rows</div>
          )}
        </div>
      );
    }
    return <div className="text-xs text-zinc-500">No results returned</div>;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-200">Query Studio</h3>
            <p className="text-xs text-zinc-500">Type in plain English → Get SQL → See results instantly</p>
          </div>
          <select
            value={connectionId}
            onChange={e => setConnectionId(Number(e.target.value))}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-blue-500"
          >
            {connections.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
            ))}
          </select>
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && executeQuery()}
            placeholder="Ask anything in plain English... e.g., 'Show all users with email addresses'"
            className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 text-sm focus:outline-none focus:border-blue-500 transition-all text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            onClick={() => executeQuery()}
            disabled={loading}
            className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running</>
            ) : "⚡ Execute"}
          </button>
        </div>

        {/* Templates */}
        <div className="flex flex-wrap gap-2 mt-3">
          {TEMPLATES.map((t, i) => (
            <button
              key={i}
              onClick={() => executeQuery(t.query)}
              className="px-3 py-1 text-[11px] rounded-full bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-all"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {results.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
            <span className="text-5xl">💬</span>
            <span className="text-sm">Ask a question or click a template to get started</span>
          </div>
        )}
        {results.map((res, i) => (
          <div key={i} className="rounded-xl bg-zinc-900/40 border border-zinc-800 overflow-hidden backdrop-blur-sm">
            {/* Query */}
            <div className="p-3 border-b border-zinc-800/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">💬</span>
                <span className="text-sm text-zinc-200 font-medium">{res.query}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  res.confidence >= 90 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  res.confidence >= 70 ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}>
                  {res.confidence}% confidence
                </span>
                <span className="text-[10px] text-zinc-500">{res.method}</span>
              </div>
            </div>
            {/* SQL */}
            <div className="px-3 py-2 bg-zinc-950/40 border-b border-zinc-800/30">
              <pre className="text-xs font-mono text-blue-400 whitespace-pre-wrap">{res.sql}</pre>
            </div>
            {/* Results */}
            <div className="p-3">
              {renderResults(res)}
              {res.row_count !== undefined && res.row_count !== null && (
                <div className="mt-2 text-[10px] text-zinc-500">{res.row_count} row(s) returned</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
